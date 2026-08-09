import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Prescription,
  PrescriptionDocument,
  PrescriptionFlag,
  PrescriptionItem,
} from './schemas/prescription.schema';
import { AiService, PROHIBITED_STEMS, CouncilItem } from '../ai/ai.service';
import { VerificationService } from '../verification/verification.service';
import { PatientsService } from '../patients/patients.service';
import { DoctorsService } from '../doctors/doctors.service';
import { NotificationsService } from '../notifications/notifications.service';
import { winAnsiSafe, drawWrappedText } from '../../common/pdf.util';

export interface RequestPrescriptionClinical {
  symptoms?: string[];
  vitals?: object;
  suspectedCondition?: string | null;
  duration?: string | null;
  urgency?: string | null;
  summary?: string | null;
  ageYears?: number | null;
  ageMonths?: number | null;
  gender?: string | null;
  pregnant?: boolean | null;
  pregnancyMonths?: number | null;
}

export interface RequestPrescriptionInput {
  patientId: string | Types.ObjectId;
  consultMode?: string;
  fieldReportId?: string | Types.ObjectId;
  clinical?: RequestPrescriptionClinical;
  /** Report-derived fields the doctor's queue card renders. */
  render?: Record<string, unknown>;
}

export interface DoctorEdit {
  items?: PrescriptionItem[];
}

const RX_DIR = path.join(process.cwd(), 'prescriptions');

@Injectable()
export class PrescriptionsService {
  constructor(
    @InjectModel(Prescription.name)
    private readonly prescriptionModel: Model<Prescription>,
    private readonly aiService: AiService,
    @Inject(forwardRef(() => VerificationService))
    private readonly verificationService: VerificationService,
    private readonly patientsService: PatientsService,
    private readonly doctorsService: DoctorsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Runs the AI council, freezes the proposed items, and queues the draft for
   * a doctor. The draft survives even with flags present - a block flag does
   * not auto-reject, it forces the doctor to Edit & approve.
   */
  async request(input: RequestPrescriptionInput): Promise<PrescriptionDocument> {
    const patient = await this.patientsService.findById(input.patientId);
    const consultMode = input.consultMode ?? 'teleconsult';
    const clinical = input.clinical ?? {};

    const result = await this.aiService.draftPrescriptionCouncil({
      patient: {
        name: patient.name,
        language: patient.language,
        ageYears: clinical.ageYears ?? null,
        ageMonths: clinical.ageMonths ?? null,
        gender: clinical.gender ?? patient.gender ?? null,
        pregnant: clinical.pregnant ?? null,
        pregnancyMonths: clinical.pregnancyMonths ?? null,
        allergies: patient.healthProfile?.allergies ?? [],
        conditions: patient.healthProfile?.conditions ?? [],
        medications: patient.healthProfile?.medications ?? [],
      },
      consultMode,
      symptoms: clinical.symptoms,
      vitals: clinical.vitals,
      suspectedCondition: clinical.suspectedCondition,
      duration: clinical.duration,
      urgency: clinical.urgency,
      sourceSummary: clinical.summary,
    });

    const prescription = await this.prescriptionModel.create({
      patient: input.patientId,
      fieldReport: input.fieldReportId,
      consultMode,
      draftItems: this.freezeItems(result.items),
      flags: result.flags,
      failedRoles: result.failedRoles,
      councilOutput: {
        ...result,
        subject: {
          name: patient.name,
          ageYears: clinical.ageYears ?? null,
          ageMonths: clinical.ageMonths ?? null,
          gender: clinical.gender ?? patient.gender ?? null,
          pregnant: clinical.pregnant ?? null,
        },
        consultMode,
      },
      status: 'awaiting-doctor',
    });

    await this.verificationService.create({
      taskType: 'prescription',
      refId: prescription._id,
      patient: input.patientId,
      aiOutput: {
        type: 'prescription',
        prescriptionId: prescription._id.toString(),
        consultMode,
        subject: {
          name: patient.name,
          ageYears: clinical.ageYears ?? null,
          ageMonths: clinical.ageMonths ?? null,
          gender: clinical.gender ?? patient.gender ?? null,
          pregnant: clinical.pregnant ?? null,
          pregnancyMonths: clinical.pregnancyMonths ?? null,
        },
        ...(input.render ?? {}),
        draftItems: result.items,
        flags: result.flags,
        failedRoles: result.failedRoles,
        summary: result.summary,
        advice: result.advice,
        followUp: result.followUp,
      },
    });

    return prescription;
  }

  /**
   * The doctor's sign-off. `items` becomes what they actually signed; the
   * deny-list is re-run on the FINAL items as a warn only - a licensed doctor
   * is the authority, so blocking their own edit would be wrong.
   */
  async issue(
    id: string | Types.ObjectId,
    doctorId: string | Types.ObjectId,
    edit?: DoctorEdit,
  ): Promise<PrescriptionDocument> {
    const prescription = await this.findById(id);
    const doctor = await this.doctorsService.findById(doctorId);
    if (!doctor.registrationNumber?.trim()) {
      throw new BadRequestException(
        'This doctor has no registration number on file - a signed prescription cannot be issued.',
      );
    }

    const edited = Array.isArray(edit?.items) ? edit.items : undefined;
    const items =
      edited && edited.length > 0
        ? edited.map((item) => ({ ...item }))
        : prescription.draftItems;

    const warnFlags = this.denyListWarnFlags(items);
    const patient = await this.patientsService.findById(prescription.patient);
    const pdfPath = await this.buildPdf(prescription, patient, doctor, items);

    prescription.items = items;
    prescription.pdfPath = pdfPath;
    prescription.signedBy = `Dr. ${doctor.name} (${doctor.specialty}) · ${doctor.registrationNumber}`;
    prescription.doctor = doctorId as Types.ObjectId;
    prescription.flags = [...(prescription.flags ?? []), ...warnFlags];
    prescription.status = 'issued';
    prescription.issuedAt = new Date();
    await prescription.save();

    await this.notificationsService.create({
      user: patient.user,
      title: 'Your prescription is ready',
      body: `${prescription.signedBy} verified and signed your prescription. You can download the PDF now.`,
      type: 'verification',
      ref: { prescriptionId: prescription._id.toString() },
    });

    return prescription;
  }

  async reject(
    id: string | Types.ObjectId,
    doctorId: string | Types.ObjectId,
    comment?: string,
  ) {
    const prescription = await this.prescriptionModel
      .findByIdAndUpdate(
        id,
        {
          status: 'rejected',
          rejectReason: comment,
          doctor: doctorId,
        },
        { new: true },
      )
      .exec();
    if (!prescription) return null;

    const patient = await this.patientsService
      .findById(prescription.patient)
      .catch(() => null);
    if (patient) {
      await this.notificationsService.create({
        user: patient.user,
        title: 'Prescription not approved',
        body:
          comment?.trim() ||
          'A doctor could not approve the AI-drafted prescription. Please book a consultation to discuss it.',
        type: 'verification',
        ref: { prescriptionId: prescription._id.toString() },
      });
    }

    return prescription;
  }

  async findById(id: string | Types.ObjectId): Promise<PrescriptionDocument> {
    const prescription = await this.prescriptionModel.findById(id).exec();
    if (!prescription) throw new NotFoundException('Prescription not found');
    return prescription;
  }

  /** Pass no patientId (doctors) to skip the ownership check. */
  async pdfPath(
    id: string | Types.ObjectId,
    patientId?: string,
  ): Promise<string> {
    const prescription = await this.findById(id);
    if (patientId && prescription.patient.toString() !== patientId) {
      // 404, not 403 - don't confirm the prescription exists.
      throw new NotFoundException('Prescription not found');
    }
    if (!prescription.pdfPath)
      throw new NotFoundException('Prescription not yet issued');
    return prescription.pdfPath;
  }

  /**
   * draftItems is the audit record of what the AI proposed, so the in-memory
   * array is frozen the moment it exists - nothing downstream can mutate it.
   */
  private freezeItems(items: CouncilItem[]): PrescriptionItem[] {
    const clean = this.toSchemaItems(items);
    for (const item of clean) Object.freeze(item);
    return Object.freeze(clean) as PrescriptionItem[];
  }

  private toSchemaItems(items: CouncilItem[]): PrescriptionItem[] {
    return items.map((item) => {
      const clean: Record<string, unknown> = { name: item.name };
      if (item.dose != null) clean.dose = item.dose;
      if (item.frequency != null) clean.frequency = item.frequency;
      if (item.durationDays != null) clean.durationDays = item.durationDays;
      if (item.instructions != null) clean.instructions = item.instructions;
      if (item.tpgList != null) clean.tpgList = item.tpgList;
      return clean as unknown as PrescriptionItem;
    });
  }

  private denyListWarnFlags(items: Array<{ name: string }>): PrescriptionFlag[] {
    const flags: PrescriptionFlag[] = [];
    for (const item of items) {
      const stem = item.name.toLowerCase().replace(/[^a-z]/g, '');
      if (PROHIBITED_STEMS.some((p) => stem === p || stem.startsWith(p))) {
        flags.push({
          severity: 'warn',
          role: 'system',
          message: `${item.name} is on the prohibited list. You signed it anyway as the licensed authority.`,
          itemName: item.name,
        });
      }
    }
    return flags;
  }

  private async buildPdf(
    prescription: PrescriptionDocument,
    patient: { name: string },
    doctor: { name: string; specialty: string; registrationNumber?: string },
    items: PrescriptionItem[],
  ): Promise<string> {
    if (!fs.existsSync(RX_DIR)) fs.mkdirSync(RX_DIR, { recursive: true });

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const page = pdf.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

    // Same frame as the certificate so it reads as one product.
    page.drawRectangle({
      x: 40,
      y: 40,
      width: width - 80,
      height: height - 80,
      borderColor: rgb(0.03, 0.42, 0.42),
      borderWidth: 3,
    });
    page.drawRectangle({
      x: 48,
      y: 48,
      width: width - 96,
      height: height - 96,
      borderColor: rgb(0.03, 0.42, 0.42),
      borderWidth: 1,
    });

    page.drawText('MEDASSIST HEALTH', {
      x: 60,
      y: height - 90,
      size: 22,
      font: bold,
      color: rgb(0.03, 0.42, 0.42),
    });
    page.drawText('E-Prescription', {
      x: 60,
      y: height - 120,
      size: 16,
      font: bold,
    });
    page.drawText(
      `Prescription ID: ${prescription._id.toString().slice(-8).toUpperCase()}`,
      {
        x: 60,
        y: height - 145,
        size: 9,
        font,
        color: rgb(0.35, 0.35, 0.35),
      },
    );

    // Rx mark
    page.drawText('Rx', {
      x: 60,
      y: height - 195,
      size: 26,
      font: bold,
      color: rgb(0.03, 0.42, 0.42),
    });

    const subject = (
      prescription.councilOutput as
        | {
            subject?: {
              ageYears?: number | null;
              ageMonths?: number | null;
              gender?: string | null;
            };
          }
        | undefined
    )?.subject;
    const ageLine =
      subject?.ageYears != null
        ? `${subject.ageYears} yrs`
        : subject?.ageMonths != null
          ? `${subject.ageMonths} mo`
          : '';
    const patientLine = `Patient: ${winAnsiSafe(patient.name)}${
      ageLine ? `, ${ageLine}` : ''
    }${subject?.gender ? `, ${winAnsiSafe(subject.gender)}` : ''}`;
    page.drawText(patientLine, {
      x: 60,
      y: height - 225,
      size: 12,
      font: bold,
    });

    // Numbered drug table
    let cy = height - 255;
    items.forEach((item, index) => {
      if (cy < 120) return;
      const tokens = [
        item.dose,
        item.frequency,
        item.durationDays != null ? `${item.durationDays} days` : undefined,
        item.instructions,
      ]
        .filter((t): t is string => !!t)
        .join(' · ');
      const line = `${index + 1}. ${item.name}${tokens ? `  —  ${tokens}` : ''}`;
      page.drawText(winAnsiSafe(line.slice(0, 120)), {
        x: 60,
        y: cy,
        size: 11,
        font,
        color: rgb(0.15, 0.15, 0.15),
      });
      cy -= 20;
    });

    const advice = (
      prescription.councilOutput as { advice?: string } | undefined
    )?.advice;
    if (advice) {
      cy -= 14;
      page.drawText('Advice', { x: 60, y: cy, size: 12, font: bold });
      cy -= 4;
      drawWrappedText(page, winAnsiSafe(advice), 60, cy - 14, 475, 14, font);
      cy -= 30;
    }

    const followUp = (
      prescription.councilOutput as { followUp?: string } | undefined
    )?.followUp;
    if (followUp) {
      cy -= 14;
      page.drawText('Follow-up', { x: 60, y: cy, size: 12, font: bold });
      cy -= 4;
      drawWrappedText(page, winAnsiSafe(followUp), 60, cy - 14, 475, 14, font);
    }

    page.drawText(
      `Signed by: Dr. ${winAnsiSafe(doctor.name)} (${winAnsiSafe(doctor.specialty)})`,
      {
        x: 60,
        y: 150,
        size: 12,
        font: bold,
        color: rgb(0.03, 0.42, 0.42),
      },
    );
    if (doctor.registrationNumber) {
      page.drawText(`Reg. No. ${winAnsiSafe(doctor.registrationNumber)}`, {
        x: 60,
        y: 128,
        size: 10,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
    }
    page.drawText(
      `Issued under a ${winAnsiSafe(prescription.consultMode)} teleconsultation.`,
      {
        x: 60,
        y: 106,
        size: 9,
        font,
        color: rgb(0.35, 0.35, 0.35),
      },
    );
    page.drawText('Verified electronically by a licensed physician.', {
      x: 60,
      y: 84,
      size: 9,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    page.drawText(`Issued: ${new Date().toLocaleDateString('en-IN')}`, {
      x: 60,
      y: 62,
      size: 9,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });

    const filePath = path.join(RX_DIR, `${prescription._id.toString()}.pdf`);
    const bytes = await pdf.save();
    fs.writeFileSync(filePath, bytes);
    return filePath;
  }
}
