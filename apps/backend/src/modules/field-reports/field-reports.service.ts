import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fsp from 'node:fs/promises';
import {
  FieldReport,
  FieldReportDocument,
  Urgency,
} from './schemas/field-report.schema';
import type { Vitals } from './schemas/field-report.schema';
import { AiService } from '../ai/ai.service';
import type { FieldReportExtraction } from '../ai/ai.service';
import { AuthService } from '../auth/auth.service';
import { HealthWorkersService } from '../health-workers/health-workers.service';
import { FacilitiesService } from '../facilities/facilities.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { FieldNotesService } from '../field-notes/field-notes.service';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import type { HealthWorkerDocument } from '../health-workers/schemas/health-worker.schema';
import { idFilter } from '../../common/mongoose.util';

export interface SubmitSubject {
  name: string;
  phone: string;
  ageYears?: number;
  ageMonths?: number;
  gender?: string;
  pregnant?: boolean;
  pregnancyMonths?: number;
}

export interface SubmitFieldReportInput {
  subject: SubmitSubject;
  language?: string;
  symptoms?: string[];
  duration?: string;
  trend?: string;
  urgency?: Urgency;
  dangerSigns?: string[];
  vitals?: Vitals;
  narrative?: string;
  geo?: { lat: number; lng: number; accuracyM?: number; picked?: boolean };
}

export interface SubmitOpts {
  channel?: 'web' | 'voice';
  /** False for any transport that is not an authenticated browser session. */
  trustGeo?: boolean;
  /** Already-run extraction, so the model is not called a second time. */
  extraction?: FieldReportExtraction | null;
  /** From the JWT, used as the doctor's contact when the subject has no number. */
  workerPhone?: string;
}

/** The plain merged shape, before Mongoose casts it into a subdocument. */
interface MergedExtraction {
  symptoms: string[];
  vitals: Vitals;
  duration?: string;
  trend?: string;
  urgency?: Urgency;
  suspectedCondition?: string;
  suggestedSpecialty?: string;
  pregnancyStatus?: boolean;
  pregnancyMonths?: number;
  ageMonths?: number;
  gender?: string;
  dangerSigns: string[];
  redFlags: string[];
  summary?: string;
  confidence?: number;
}

const VITAL_LABELS: Record<string, (v: number) => string> = {
  temperatureC: (v) => `temp ${v} °C`,
  spo2: (v) => `SpO2 ${v}%`,
  pulse: (v) => `pulse ${v}/min`,
  respRate: (v) => `resp ${v}/min`,
  systolic: (v) => `systolic ${v} mmHg`,
  diastolic: (v) => `diastolic ${v} mmHg`,
  weightKg: (v) => `weight ${v} kg`,
  glucoseMgDl: (v) => `glucose ${v} mg/dL`,
};

const IN_PERSON_URGENCY = new Set(['urgent', 'emergency']);

/** A semi-urgent case is fine on a call-back; an emergency needs a body in a room. */
function isInPerson(urgency?: string, facility?: unknown): boolean {
  return Boolean(facility) && IN_PERSON_URGENCY.has(urgency ?? '');
}

function digitsOnly(phone?: string | null): string {
  return (phone ?? '').replace(/[^\d+]/g, '');
}

const LOCAL_PREFIX = 'local:';

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'unnamed'
  );
}

/**
 * Identity for a villager with no phone. `Patient -> User -> phone` is
 * required+unique, so something has to fill it; this is deliberately not
 * dialable, and deterministic so the same person reported twice by the same
 * worker resolves to one record.
 *
 * Built here rather than by the caller: digitsOnly() would strip the prefix and
 * leave a string that looks like a real number.
 *
 * ponytail: two people of the same name in one worker's area collapse into one
 * patient. A worker-facing "is this the same Sita Devi?" prompt is the upgrade.
 */
function localIdentity(workerId: string, name: string): string {
  return `${LOCAL_PREFIX}${workerId}:${slug(name)}`;
}

export function isReachablePhone(phone: string): boolean {
  return phone.length > 0 && !phone.startsWith(LOCAL_PREFIX);
}

@Injectable()
export class FieldReportsService {
  private readonly logger = new Logger(FieldReportsService.name);

  constructor(
    @InjectModel(FieldReport.name)
    private readonly reportModel: Model<FieldReport>,
    private readonly aiService: AiService,
    private readonly authService: AuthService,
    private readonly healthWorkersService: HealthWorkersService,
    private readonly facilitiesService: FacilitiesService,
    private readonly appointmentsService: AppointmentsService,
    private readonly fieldNotesService: FieldNotesService,
    private readonly prescriptionsService: PrescriptionsService,
  ) {}

  /**
   * Order matters: the report is persisted before extraction and before
   * routing, so a bad minute from the model or a routing failure still leaves
   * durable field data instead of losing a village visit.
   */
  async submit(
    workerId: string | undefined,
    input: SubmitFieldReportInput,
    opts: SubmitOpts = {},
  ): Promise<FieldReportDocument> {
    const { channel = 'web', trustGeo = true, extraction: given } = opts;
    if (!workerId) {
      throw new ForbiddenException('No health worker linked to this account');
    }
    const worker = await this.healthWorkersService.findById(workerId);

    // An empty phone must never reach findOrCreatePatientByPhone: User.phone is
    // unique, so every anonymous villager would collapse onto one shared record.
    const typed = digitsOnly(input.subject.phone);
    const phone =
      typed || localIdentity(String(worker._id), input.subject.name);
    const reachable = isReachablePhone(phone);
    const language = input.language ?? worker.languages?.[0] ?? 'en';
    const { patientId } = await this.authService.findOrCreatePatientByPhone(
      phone,
      { name: input.subject.name, language },
    );

    const location = this.resolveLocation(worker, input.geo, trustGeo);
    const facility = await this.facilitiesService.findNearest(
      location.point?.coordinates,
      {
        village: location.village,
        block: location.block,
        district: location.district,
      },
    );

    const report = await this.reportModel.create({
      worker: worker._id,
      patient: patientId,
      channel,
      language,
      rawTranscript: input.narrative,
      location,
      facility: facility?._id,
      subjectReachable: reachable,
      consent: { basis: 'explicit', at: new Date() },
      status: 'extracting',
    });

    // A caller that already ran the extractor (the voice path, which needs the
    // classification up front) passes it in, so the model is never billed twice
    // and the stored extraction cannot disagree with the routing decision.
    const extraction =
      given ?? (await this.extract(report, worker, input, language));
    // Keep the plain merged object and route from it. Reading it back off the
    // document would hand route() a Mongoose subdocument, where Object.entries
    // yields internal keys and the vitals silently vanish from the brief.
    const merged = this.merge(extraction, input);
    report.extraction = merged;
    report.status = 'submitted';
    await report.save();

    await this.route(
      report,
      merged,
      worker,
      facility?.name,
      facility?._id,
      opts.workerPhone,
      facility?.phone,
    );
    return report;
  }

  private async extract(
    report: FieldReportDocument,
    worker: HealthWorkerDocument,
    input: SubmitFieldReportInput,
    language: string,
  ): Promise<FieldReportExtraction | null> {
    const rawText = [
      input.narrative,
      input.symptoms?.length ? `Symptoms: ${input.symptoms.join(', ')}` : '',
      input.duration ? `Duration: ${input.duration}` : '',
      input.trend ? `Trend: ${input.trend}` : '',
      input.dangerSigns?.length
        ? `Danger signs: ${input.dangerSigns.join(', ')}`
        : '',
      input.urgency ? `Worker's own urgency judgement: ${input.urgency}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    if (!rawText) return null;

    try {
      return await this.aiService.extractFieldReport(
        {
          rawText,
          worker: {
            name: worker.name,
            cadre: worker.cadre,
            village: worker.village,
          },
          known: {
            name: input.subject.name,
            phone: digitsOnly(input.subject.phone),
            ageYears: input.subject.ageYears,
            gender: input.subject.gender,
            pregnant: input.subject.pregnant,
            vitals: input.vitals,
          },
        },
        language,
      );
    } catch (error) {
      // The report survives with aiError set and shows to the doctor as raw
      // worker notes. A village visit is never lost to a model outage.
      report.aiError = (error as Error).message;
      this.logger.warn(
        `Extraction failed for report ${report._id.toString()}: ${report.aiError}`,
      );
      return null;
    }
  }

  /** Typed form fields win; the model only fills blanks. The worker typed the phone. */
  private merge(
    extraction: FieldReportExtraction | null,
    input: SubmitFieldReportInput,
  ): MergedExtraction {
    // Both sides stripped of nulls: the prompt asks the model to emit null for
    // anything unmeasured, and an absent key is the honest way to store that.
    const dropNulls = (v: object): Vitals =>
      Object.fromEntries(
        Object.entries(v).filter(([, value]) => value != null),
      );
    const typedVitals = dropNulls(input.vitals ?? {});
    const ageMonths =
      input.subject.ageMonths ??
      (input.subject.ageYears != null
        ? input.subject.ageYears * 12
        : (extraction?.subject.ageMonths ??
          (extraction?.subject.ageYears != null
            ? extraction.subject.ageYears * 12
            : undefined)));

    return {
      symptoms: input.symptoms?.length
        ? input.symptoms
        : (extraction?.symptoms ?? []),
      vitals: { ...dropNulls(extraction?.vitals ?? {}), ...typedVitals },
      duration: input.duration ?? extraction?.duration ?? undefined,
      trend: input.trend ?? extraction?.trend ?? undefined,
      urgency: this.worstUrgency(input.urgency, extraction?.urgency),
      suspectedCondition: extraction?.suspectedCondition ?? undefined,
      suggestedSpecialty: extraction?.suggestedSpecialty ?? undefined,
      pregnancyStatus:
        input.subject.pregnant ?? extraction?.subject.pregnant ?? undefined,
      pregnancyMonths:
        input.subject.pregnancyMonths ??
        extraction?.subject.pregnancyMonths ??
        undefined,
      ageMonths,
      gender: input.subject.gender ?? extraction?.subject.gender ?? undefined,
      dangerSigns: input.dangerSigns?.length
        ? input.dangerSigns
        : (extraction?.dangerSigns ?? []),
      redFlags: extraction?.redFlags ?? [],
      summary: extraction?.summary ?? undefined,
      confidence: extraction?.confidence ?? undefined,
    };
  }

  /** The model may escalate the worker's judgement, never downgrade it. */
  private worstUrgency(
    typed?: string | null,
    modelSaid?: string | null,
  ): Urgency | undefined {
    const order: Urgency[] = ['routine', 'semi-urgent', 'urgent', 'emergency'];
    const rank = (v?: string | null) => order.indexOf(v as Urgency);
    const worst = rank(typed) >= rank(modelSaid) ? typed : modelSaid;
    return rank(worst) >= 0 ? (worst as Urgency) : undefined;
  }

  private resolveLocation(
    worker: HealthWorkerDocument,
    geo: SubmitFieldReportInput['geo'],
    trustGeo: boolean,
  ) {
    const area = {
      village: worker.village,
      block: worker.block,
      district: worker.district,
    };

    // The predicate is trust, not modality: only a browser under this worker's
    // authenticated session can produce a coordinate. An in-browser voice call
    // has a real browser and a real tapped point, so gating on channel would
    // have thrown that away. An unauthenticated transport passes no geo at all,
    // and this branch stays the only writer of 'assigned'.
    if (trustGeo && geo) {
      return {
        point: { type: 'Point' as const, coordinates: [geo.lng, geo.lat] },
        source: geo.picked ? ('picked' as const) : ('gps' as const),
        accuracyM: geo.picked ? undefined : geo.accuracyM,
        ...area,
      };
    }

    return {
      point: worker.coordinates?.length
        ? { type: 'Point' as const, coordinates: worker.coordinates }
        : undefined,
      source: 'assigned' as const,
      ...area,
    };
  }

  private async route(
    report: FieldReportDocument,
    e: MergedExtraction,
    worker: HealthWorkerDocument,
    facilityName?: string,
    facilityId?: Types.ObjectId,
    workerPhone?: string,
    facilityPhone?: string,
  ) {
    try {
      const escalated = isInPerson(e.urgency, facilityId);
      const { appointment, doctor } = await this.appointmentsService.book({
        patientId: report.patient,
        reason:
          e.summary ??
          report.rawTranscript ??
          'Field report by a health worker',
        preferredWindow: 'As soon as possible',
        specialty: this.specialtyFor(e),
        symptoms: e.symptoms,
        urgency: e.urgency,
        vitals: this.vitalLines(e.vitals),
        type: escalated ? 'in-person' : 'call-back',
        facility: facilityId,
        aiNotes: { fieldReportId: report._id.toString(), ...e },
        reportedBy: {
          workerName: worker.name,
          cadre: worker.cadre,
          village: report.location.village,
          facilityName,
        },
        // No dialable number means no account to log into and nobody for the
        // doctor to ring, so the worker becomes both the contact and the
        // recipient - they are the person standing next to the patient.
        ...(report.subjectReachable
          ? {}
          : { notifyUser: worker.user, bestContactNumber: workerPhone }),
        // Told as well as the patient on a referral, never instead - book()
        // skips the second message when they are already the notifyUser.
        workerUser: worker.user,
        facilityPhone,
      });
      report.appointment = appointment._id;
      if (doctor) {
        report.matchedDoctor = {
          name: doctor.name,
          specialty: doctor.specialty,
          title: doctor.title,
        };
      }
      report.status = 'routed';

      // A simple (non-escalated) illness gets the AI council draft. Escalated
      // cases need a body in a room, so no remote prescription is drafted.
      if (!escalated) {
        await this.tryDraftPrescription(report, e, worker, facilityName);
      }
    } catch (error) {
      report.routingError = (error as Error).message;
      report.status = 'failed';
      this.logger.error(
        `Routing failed for report ${report._id.toString()}: ${report.routingError}`,
      );
    }
    await report.save();
  }

  /**
   * Best-effort, strictly last: a bad minute from the council must not unroute
   * a report that already reached a doctor. The draft is queued for the
   * doctor's verification queue; failure just means the doctor reads the raw
   * worker notes instead.
   */
  private async tryDraftPrescription(
    report: FieldReportDocument,
    e: MergedExtraction,
    worker: HealthWorkerDocument,
    facilityName?: string,
  ) {
    try {
      const prescription = await this.prescriptionsService.request({
        patientId: report.patient,
        fieldReportId: report._id,
        consultMode: 'teleconsult',
        // No phone in the household means no account to log into, so the
        // signed prescription goes to the worker who filed it.
        ...(report.subjectReachable ? {} : { notifyUser: worker.user }),
        clinical: {
          symptoms: e.symptoms,
          vitals: e.vitals,
          suspectedCondition: e.suspectedCondition,
          duration: e.duration,
          urgency: e.urgency,
          summary: e.summary,
          ageYears:
            e.ageMonths != null ? Math.round(e.ageMonths / 12) : undefined,
          ageMonths: e.ageMonths,
          gender: e.gender,
          pregnant: e.pregnancyStatus,
          pregnancyMonths: e.pregnancyMonths,
        },
        render: {
          symptoms: e.symptoms,
          vitals: e.vitals,
          dangerSigns: e.dangerSigns,
          urgency: e.urgency,
          suspectedCondition: e.suspectedCondition,
          reportedBy: {
            workerName: worker.name,
            cadre: worker.cadre,
            village: report.location.village,
            facilityName,
          },
          geo: {
            source: report.location.source,
            accuracyM: report.location.accuracyM,
            // [lng, lat] on the way out too - the doctor's card builds a maps
            // link from this and swapping them lands it in the wrong hemisphere.
            coordinates: report.location.point?.coordinates,
            village: report.location.village,
            block: report.location.block,
            district: report.location.district,
          },
          matchedDoctor: report.matchedDoctor,
        },
      });
      report.prescription = prescription._id;
    } catch (error) {
      this.logger.warn(
        `Prescription council failed for report ${report._id.toString()}: ${(error as Error).message}`,
      );
    }
  }

  /** ponytail: a demo heuristic, not a triage protocol. */
  private specialtyFor(e: MergedExtraction) {
    if (e.suggestedSpecialty) return e.suggestedSpecialty;
    if (e.pregnancyStatus) return 'Obstetrics';
    if (e.ageMonths != null && e.ageMonths <= 60) return 'Pediatrics';
    return undefined;
  }

  private vitalLines(vitals: Vitals): string[] {
    return Object.entries(vitals ?? {})
      .filter(([key, value]) => value != null && VITAL_LABELS[key])
      .map(([key, value]) => VITAL_LABELS[key](value as number));
  }

  /**
   * A finished ASHA voice call. Classifies the transcript once, then either
   * files a report through the normal `submit()` path or saves a note.
   *
   * Failure is deliberately asymmetric: an unreadable or failed extraction is
   * treated as a REPORT with the raw transcript attached, never as a note. A
   * worker who rang the field line was almost certainly ringing about a person,
   * and a note reaches no doctor.
   */
  async ingestFromCall(
    workerId: string | undefined,
    input: {
      transcript: string;
      geo?: SubmitFieldReportInput['geo'];
      language?: string;
      workerPhone?: string;
    },
  ): Promise<{
    kind: 'report' | 'note';
    report?: FieldReportDocument;
    noteId?: string;
    transcript: string;
  }> {
    if (!workerId) {
      throw new ForbiddenException('No health worker linked to this account');
    }
    const worker = await this.healthWorkersService.findById(workerId);
    const language = input.language ?? worker.languages?.[0] ?? 'en';

    let extraction: FieldReportExtraction | null = null;
    try {
      extraction = await this.aiService.extractFieldReport(
        {
          rawText: input.transcript,
          worker: {
            name: worker.name,
            cadre: worker.cadre,
            village: worker.village,
          },
        },
        language,
      );
    } catch (error) {
      this.logger.warn(
        `Call classification failed, filing as a report: ${(error as Error).message}`,
      );
    }

    if (extraction?.kind === 'note') {
      const note = await this.fieldNotesService.create(workerId, {
        title: extraction.noteTitle ?? undefined,
        body: input.transcript,
        village: worker.village,
        geo: input.geo ? { lat: input.geo.lat, lng: input.geo.lng } : undefined,
      });
      return {
        kind: 'note',
        noteId: note._id.toString(),
        transcript: input.transcript,
      };
    }

    const report = await this.submit(
      workerId,
      {
        subject: {
          // A report about nobody cannot exist, so an unnamed subject still gets
          // a stable label rather than blocking the filing.
          name: extraction?.subject.name?.trim() || 'Unnamed subject',
          phone: extraction?.subject.phone ?? '',
          ageYears: extraction?.subject.ageYears ?? undefined,
          ageMonths: extraction?.subject.ageMonths ?? undefined,
          gender: extraction?.subject.gender ?? undefined,
          pregnant: extraction?.subject.pregnant ?? undefined,
          pregnancyMonths: extraction?.subject.pregnancyMonths ?? undefined,
        },
        language,
        narrative: input.transcript,
        geo: input.geo,
      },
      {
        channel: 'voice',
        trustGeo: true,
        extraction,
        workerPhone: input.workerPhone,
      },
    );

    return { kind: 'report', report, transcript: input.transcript };
  }

  /**
   * Audio in, text out. Deliberately does *not* file anything: the worker reads
   * the transcript, fixes what was misheard, and adds the phone number that a
   * voice note usually cannot supply. The file is deleted either way.
   */
  async transcribe(
    workerId: string | undefined,
    filePath: string,
    language?: string,
  ): Promise<{ text: string }> {
    if (!workerId) {
      throw new ForbiddenException('No health worker linked to this account');
    }
    try {
      const text = await this.aiService.transcribeAudio(filePath, language);
      return { text };
    } finally {
      await fsp.rm(filePath, { force: true }).catch(() => undefined);
    }
  }

  async listForWorker(workerId: string | undefined) {
    if (!workerId) {
      throw new ForbiddenException('No health worker linked to this account');
    }
    return (
      this.reportModel
        .find(idFilter('worker', workerId))
        .sort({ createdAt: -1 })
        .populate('facility')
        // Name only: the worker filed the report, they are not owed the
        // subject's health profile or consent record.
        .populate('patient', 'name')
        .lean()
        .exec()
    );
  }

  async findForWorker(workerId: string | undefined, id: string) {
    if (!workerId) {
      throw new ForbiddenException('No health worker linked to this account');
    }
    const report = await this.reportModel
      .findById(id)
      .populate('facility')
      .populate('patient', 'name')
      // What the doctor signed, and nothing else. draftItems and councilOutput
      // are the AI's rejected proposal - an audit record for the doctor, not
      // something to read out to a household.
      .populate('prescription', 'status items signedBy issuedAt consultMode')
      .exec();
    // 404 rather than 403: a worker must not learn that someone else's report id exists.
    if (!report || String(report.worker) !== String(workerId)) {
      throw new NotFoundException('Field report not found');
    }
    return report;
  }

  /** Ownership is "you filed the report", checked by findForWorker. */
  async prescriptionPdfPath(
    workerId: string | undefined,
    reportId: string,
  ): Promise<string> {
    const report = await this.findForWorker(workerId, reportId);
    if (!report.prescription) {
      throw new NotFoundException('No prescription for this report');
    }
    // populate() replaced the id with a document, so read the id back off it.
    const id = String(
      (report.prescription as unknown as { _id?: unknown })._id ??
        report.prescription,
    );
    return this.prescriptionsService.pdfPath(id);
  }
}
