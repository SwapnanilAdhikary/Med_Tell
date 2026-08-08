import {
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
  Certificate,
  CertificateDocument,
  CertificateType,
} from './schemas/certificate.schema';
import { AiService } from '../ai/ai.service';
import { VerificationService } from '../verification/verification.service';
import { PatientsService } from '../patients/patients.service';
import { DoctorsService } from '../doctors/doctors.service';
import { NotificationsService } from '../notifications/notifications.service';
import { idFilter } from '../../common/mongoose.util';

export interface RequestCertificateInput {
  patientId: string | Types.ObjectId;
  type: CertificateType;
  language?: string;
  details?: Record<string, unknown>;
}

const CERT_DIR = path.join(process.cwd(), 'certificates');

@Injectable()
export class CertificatesService {
  constructor(
    @InjectModel(Certificate.name)
    private readonly certificateModel: Model<CertificateDocument>,
    private readonly aiService: AiService,
    @Inject(forwardRef(() => VerificationService))
    private readonly verificationService: VerificationService,
    private readonly patientsService: PatientsService,
    private readonly doctorsService: DoctorsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async request(input: RequestCertificateInput) {
    const patient = await this.patientsService.findById(input.patientId);
    const draft = await this.aiService.draftCertificate(
      input.type,
      input.language ?? patient.language ?? 'en',
      input.details ?? {},
      patient.name,
    );

    const certificate = await this.certificateModel.create({
      patient: input.patientId,
      type: input.type,
      language: input.language ?? patient.language ?? 'en',
      draftContent: draft,
      status: 'awaiting-doctor',
      validFrom: draft.validFrom
        ? new Date(draft.validFrom as string)
        : undefined,
      validTo: draft.validTo ? new Date(draft.validTo as string) : undefined,
    });

    await this.verificationService.create({
      taskType: 'certificate',
      refId: certificate._id,
      patient: input.patientId,
      aiOutput: { type: input.type, draft },
    });

    return certificate;
  }

  async listForPatient(patientId: string | Types.ObjectId) {
    return this.certificateModel
      .find(idFilter('patient', patientId))
      .sort({ createdAt: -1 })
      .populate('doctor')
      .lean()
      .exec();
  }

  async listAll(filter: Record<string, unknown> = {}) {
    return this.certificateModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('patient')
      .lean()
      .exec();
  }

  async issue(id: string | Types.ObjectId, doctorId: string | Types.ObjectId) {
    const certificate = await this.certificateModel.findById(id).exec();
    if (!certificate) throw new NotFoundException('Certificate not found');

    const doctor = await this.doctorsService.findById(doctorId);
    const patient = await this.patientsService.findById(certificate.patient);

    const pdfPath = await this.buildPdf(certificate, patient.name, doctor.name);
    certificate.finalContent =
      (certificate.draftContent as { body?: string })?.body ?? '';
    certificate.pdfPath = pdfPath;
    certificate.signedBy = `Dr. ${doctor.name} (${doctor.specialty})`;
    certificate.doctor = doctorId as Types.ObjectId;
    certificate.status = 'issued';
    certificate.issuedAt = new Date();
    await certificate.save();

    await this.notificationsService.create({
      user: patient.user,
      title: 'Your medical certificate is ready',
      body: `${certificate.signedBy} verified and signed your ${certificate.type} certificate. You can download the PDF now.`,
      type: 'certificate',
      ref: { certificateId: certificate._id.toString() },
    });

    return certificate;
  }

  async reject(
    id: string | Types.ObjectId,
    doctorId: string | Types.ObjectId,
    comment?: string,
  ) {
    const certificate = await this.certificateModel
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
    if (!certificate) return null;

    const patient = await this.patientsService
      .findById(certificate.patient)
      .catch(() => null);
    if (patient) {
      await this.notificationsService.create({
        user: patient.user,
        title: 'Certificate request declined',
        body:
          comment?.trim() ||
          `A doctor could not approve your ${certificate.type} certificate. Please book a consultation to discuss it.`,
        type: 'certificate',
        ref: { certificateId: certificate._id.toString() },
      });
    }

    return certificate;
  }

  async findById(id: string | Types.ObjectId) {
    const certificate = await this.certificateModel.findById(id).exec();
    if (!certificate) throw new NotFoundException('Certificate not found');
    return certificate;
  }

  /** Pass no patientId (doctors) to skip the ownership check. */
  async pdfPath(
    id: string | Types.ObjectId,
    patientId?: string,
  ): Promise<string> {
    const certificate = await this.findById(id);
    if (patientId && certificate.patient.toString() !== patientId) {
      // 404, not 403 - don't confirm the certificate exists.
      throw new NotFoundException('Certificate not found');
    }
    if (!certificate.pdfPath)
      throw new NotFoundException('Certificate not yet issued');
    return certificate.pdfPath;
  }

  private async buildPdf(
    certificate: CertificateDocument,
    patientName: string,
    doctorName: string,
  ): Promise<string> {
    if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const page = pdf.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

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
    page.drawText('Medical Certificate', {
      x: 60,
      y: height - 120,
      size: 16,
      font: bold,
    });
    page.drawText(
      `Certificate ID: ${certificate._id.toString().slice(-8).toUpperCase()}`,
      {
        x: 60,
        y: height - 145,
        size: 9,
        font,
        color: rgb(0.35, 0.35, 0.35),
      },
    );

    const title =
      (certificate.draftContent as { title?: string })?.title ??
      'Medical Certificate';
    page.drawText(title, {
      x: 60,
      y: height - 200,
      size: 14,
      font: bold,
    });

    const body = (certificate.draftContent as { body?: string })?.body ?? '';
    this.drawWrappedText(page, body, 60, height - 230, 475, 14, font);

    page.drawText(`This is to certify that: ${patientName}`, {
      x: 60,
      y: 220,
      size: 12,
      font: bold,
    });

    page.drawText(`Signed by: ${doctorName}`, {
      x: 60,
      y: 140,
      size: 12,
      font: bold,
      color: rgb(0.03, 0.42, 0.42),
    });
    page.drawText('Verified electronically by a licensed physician.', {
      x: 60,
      y: 118,
      size: 9,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    page.drawText(`Issued: ${new Date().toLocaleDateString('en-IN')}`, {
      x: 60,
      y: 96,
      size: 9,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });

    const filePath = path.join(CERT_DIR, `${certificate._id.toString()}.pdf`);
    const bytes = await pdf.save();
    fs.writeFileSync(filePath, bytes);
    return filePath;
  }

  private drawWrappedText(
    page: import('pdf-lib').PDFPage,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    font: import('pdf-lib').PDFFont,
  ) {
    const words = text.split(/\s+/);
    let line = '';
    let cy = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, 11) > maxWidth) {
        page.drawText(line, {
          x,
          y: cy,
          size: 11,
          font,
          color: rgb(0.15, 0.15, 0.15),
        });
        line = word;
        cy -= lineHeight;
      } else {
        line = test;
      }
    }
    if (line)
      page.drawText(line, {
        x,
        y: cy,
        size: 11,
        font,
        color: rgb(0.15, 0.15, 0.15),
      });
  }
}
