import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
  geo?: { lat: number; lng: number; accuracyM?: number };
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
  ) {}

  /**
   * Order matters: the report is persisted before extraction and before
   * routing, so a bad minute from the model or a routing failure still leaves
   * durable field data instead of losing a village visit.
   */
  async submit(
    workerId: string | undefined,
    input: SubmitFieldReportInput,
    channel: 'web' | 'voice' = 'web',
  ): Promise<FieldReportDocument> {
    if (!workerId) {
      throw new ForbiddenException('No health worker linked to this account');
    }
    const worker = await this.healthWorkersService.findById(workerId);

    const phone = digitsOnly(input.subject.phone);
    const language = input.language ?? worker.languages?.[0] ?? 'en';
    const { patientId } = await this.authService.findOrCreatePatientByPhone(
      phone,
      { name: input.subject.name, language },
    );

    const location = this.resolveLocation(worker, input.geo, channel);
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
      consent: { basis: 'explicit', at: new Date() },
      status: 'extracting',
    });

    const extraction = await this.extract(report, worker, input, language);
    // Keep the plain merged object and route from it. Reading it back off the
    // document would hand route() a Mongoose subdocument, where Object.entries
    // yields internal keys and the vitals silently vanish from the brief.
    const merged = this.merge(extraction, input);
    report.extraction = merged;
    report.status = 'submitted';
    await report.save();

    await this.route(report, merged, worker, facility?.name, facility?._id);
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
    channel: 'web' | 'voice',
  ) {
    const area = {
      village: worker.village,
      block: worker.block,
      district: worker.district,
    };

    // A phone-in worker has no browser, so a body coordinate could only be a
    // lie. Voice always falls back to the assigned area.
    if (channel === 'web' && geo) {
      return {
        point: { type: 'Point' as const, coordinates: [geo.lng, geo.lat] },
        source: 'gps' as const,
        accuracyM: geo.accuracyM,
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
  ) {
    try {
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
        type: isInPerson(e.urgency, facilityId) ? 'in-person' : 'call-back',
        facility: facilityId,
        aiNotes: { fieldReportId: report._id.toString(), ...e },
        reportedBy: {
          workerName: worker.name,
          cadre: worker.cadre,
          village: report.location.village,
          facilityName,
        },
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
    } catch (error) {
      report.routingError = (error as Error).message;
      report.status = 'failed';
      this.logger.error(
        `Routing failed for report ${report._id.toString()}: ${report.routingError}`,
      );
    }
    await report.save();
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

  async listForWorker(workerId: string | undefined) {
    if (!workerId) {
      throw new ForbiddenException('No health worker linked to this account');
    }
    return this.reportModel
      .find(idFilter('worker', workerId))
      .sort({ createdAt: -1 })
      .populate('facility')
      // Name only: the worker filed the report, they are not owed the
      // subject's health profile or consent record.
      .populate('patient', 'name')
      .lean()
      .exec();
  }

  async findForWorker(workerId: string | undefined, id: string) {
    if (!workerId) {
      throw new ForbiddenException('No health worker linked to this account');
    }
    const report = await this.reportModel
      .findById(id)
      .populate('facility')
      .populate('patient', 'name')
      .exec();
    // 404 rather than 403: a worker must not learn that someone else's report id exists.
    if (!report || String(report.worker) !== String(workerId)) {
      throw new NotFoundException('Field report not found');
    }
    return report;
  }
}
