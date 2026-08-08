import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  CallSession,
  CallSessionDocument,
} from './schemas/call-session.schema';
import { AiService } from '../ai/ai.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { VerificationService } from '../verification/verification.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PatientsService } from '../patients/patients.service';
import { CertificatesService } from '../certificates/certificates.service';
import type { CertificateType } from '../certificates/schemas/certificate.schema';
import { idFilter } from '../../common/mongoose.util';
import { AuthService } from '../auth/auth.service';

export interface VapiWebhookPayload {
  message?: {
    type?: string;
    call?: {
      id?: string;
      assistantId?: string;
      phoneNumber?: { number?: string };
      startedAt?: string;
      endedAt?: string;
      status?: string;
    };
    transcript?: Array<{ role?: string; content?: string }>;
    transcriptText?: string;
    summary?: string;
    cost?: number;
  };
}

/** What the browser posts when a web call ends (identity comes from the JWT). */
export interface CompleteWebCallInput {
  vapiCallId: string;
  transcript?: Array<{ role?: string; content?: string }>;
  transcriptText?: string;
  startedAt?: string;
  endedAt?: string;
}

const CERT_TYPES: CertificateType[] = [
  'sick-leave',
  'fitness',
  'medical',
  'insurance',
];

const ROUTE_TO_DOCTOR = new Set(['urgent', 'emergency', 'semi-urgent']);

const SUPPORTED_LANGUAGES = ['en', 'hi', 'bn'];

const NONE_RECORDED: Record<string, string> = {
  en: 'none recorded',
  hi: 'कोई दर्ज नहीं',
  bn: 'কিছু নথিভুক্ত নেই',
};

// The agent opens by name instead of asking for it.
const GREETINGS: Record<string, (name: string) => string> = {
  en: (name) =>
    `Hello ${name}, this is MedAssist. What symptoms are you experiencing today?`,
  hi: (name) =>
    `नमस्ते ${name}, मैं MedAssist हूँ। आज आपको क्या लक्षण महसूस हो रहे हैं?`,
  bn: (name) =>
    `নমস্কার ${name}, আমি MedAssist। আজ আপনি কী উপসর্গ অনুভব করছেন?`,
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function flattenTranscript(
  turns?: Array<{ role?: string; content?: string }>,
): string {
  return (turns ?? [])
    .filter((t) => t.content)
    .map((t) => `${t.role ?? 'user'}: ${t.content}`)
    .join('\n');
}

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    @InjectModel(CallSession.name)
    private readonly callModel: Model<CallSessionDocument>,
    private readonly config: ConfigService,
    private readonly aiService: AiService,
    private readonly appointmentsService: AppointmentsService,
    private readonly verificationService: VerificationService,
    private readonly authService: AuthService,
    private readonly conversationsService: ConversationsService,
    private readonly patientsService: PatientsService,
    private readonly certificatesService: CertificatesService,
  ) {}

  /**
   * Everything the browser needs to open a call that already knows who is
   * calling: the assistant, the patient's own details as Vapi template
   * variables, and a greeting that uses their name.
   */
  async getWebSession(patientId: string, language?: string) {
    const patient = await this.patientsService.findById(patientId);
    const selected = SUPPORTED_LANGUAGES.includes(language ?? '')
      ? (language as string)
      : (patient.language ?? 'en');

    const firstName = patient.name.trim().split(/\s+/)[0] || patient.name;
    const none = NONE_RECORDED[selected] ?? NONE_RECORDED.en;
    const list = (values?: string[]) =>
      values?.length ? values.join(', ') : none;

    return {
      assistantId: this.config.get<string>('VAPI_ASSISTANT_ID', ''),
      language: selected,
      firstMessage: (GREETINGS[selected] ?? GREETINGS.en)(firstName),
      variableValues: {
        language: selected,
        patientName: patient.name,
        knownAllergies: list(patient.healthProfile?.allergies),
        knownConditions: list(patient.healthProfile?.conditions),
        medications: list(patient.healthProfile?.medications),
      },
    };
  }

  /**
   * Web calls go browser -> Vapi directly and carry no phone number, so the
   * browser posts the transcript here on call-end and the patient comes from
   * the JWT. Phone calls arrive via the webhook instead; both converge on
   * processCompletedCall.
   */
  async completeWebCall(patientId: string, input: CompleteWebCallInput) {
    const session = await this.callModel
      .findOneAndUpdate(
        { vapiCallId: input.vapiCallId },
        {
          patient: patientId,
          source: 'web',
          status: 'recorded',
          transcript: input.transcript ?? [],
          transcriptText:
            input.transcriptText ?? flattenTranscript(input.transcript),
          startedAt: input.startedAt ? new Date(input.startedAt) : undefined,
          endedAt: input.endedAt ? new Date(input.endedAt) : new Date(),
        },
        { upsert: true, new: true },
      )
      .exec();

    const outcome = await this.processCompletedCall(session);
    return { ok: true, id: session._id.toString(), ...outcome };
  }

  async handleWebhook(payload: VapiWebhookPayload) {
    const type = payload.message?.type;
    const call = payload.message?.call ?? {};

    if (type === 'status-update') {
      const session = await this.callModel
        .findOneAndUpdate(
          { vapiCallId: call.id },
          {
            status: 'started',
            assistantId: call.assistantId,
            phoneNumber: call.phoneNumber?.number,
            startedAt: call.startedAt ? new Date(call.startedAt) : undefined,
          },
          { upsert: true, new: true },
        )
        .exec();
      return { ok: true, id: session._id };
    }

    if (type === 'end-of-call-report') {
      const transcript = payload.message?.transcript ?? [];
      const transcriptText =
        payload.message?.transcriptText || flattenTranscript(transcript);

      const session = await this.callModel
        .findOneAndUpdate(
          { vapiCallId: call.id },
          {
            status: 'recorded',
            assistantId: call.assistantId,
            phoneNumber: call.phoneNumber?.number,
            startedAt: call.startedAt ? new Date(call.startedAt) : undefined,
            endedAt: call.endedAt ? new Date(call.endedAt) : undefined,
            // Don't clobber a transcript the browser already posted.
            ...(transcript.length ? { transcript } : {}),
            ...(transcriptText ? { transcriptText } : {}),
          },
          { upsert: true, new: true },
        )
        .exec();

      const outcome = await this.processCompletedCall(session);
      return { ok: true, id: session._id, ...outcome };
    }

    return { ok: true, ignored: type };
  }

  /**
   * Turns a finished call into care: summarise, route the patient brief to the
   * best-matched doctor, hand the doctor's details back to the patient, and drop
   * the whole thing into the patient's chat thread so voice and text share one
   * memory.
   */
  private async processCompletedCall(session: CallSessionDocument) {
    try {
      // A web call posts on call-end and the webhook may report the same call
      // again; summarising twice would double-book.
      if (session.summary) {
        return { linked: true, alreadyProcessed: true };
      }

      const patientId = await this.resolvePatient(session);
      if (!patientId) {
        this.logger.warn(
          `Call ${session.vapiCallId} could not be linked to a patient; skipping triage.`,
        );
        return { linked: false };
      }

      const patient = await this.patientsService.findById(patientId);
      const language = patient.language ?? 'en';

      const summary = await this.aiService.summarizeCall(
        session.transcriptText ?? '',
        language,
      );
      session.patient = patient._id as never;
      session.summary = summary;
      session.status = 'recorded';
      await session.save();

      const symptoms = asStringArray(summary.symptoms);
      const urgency = summary.urgency ? String(summary.urgency) : undefined;
      const recommendedAction = String(
        summary.recommendedAction ?? 'self_care',
      );
      const specialty = summary.suggestedSpecialty
        ? String(summary.suggestedSpecialty)
        : undefined;

      // Urgent cases route to a doctor even if the model only said "self_care".
      const shouldBook =
        recommendedAction === 'book_consultation' ||
        ROUTE_TO_DOCTOR.has(urgency ?? '');

      let matchedDoctor: { name: string; specialty: string } | null = null;
      let appointmentId: string | undefined;

      if (shouldBook) {
        const { appointment, doctor } = await this.appointmentsService.book({
          patientId,
          reason: (summary.summary as string) ?? 'Consultation requested by call',
          preferredWindow: 'As soon as possible',
          specialty,
          symptoms,
          urgency,
          aiNotes: summary,
          callSessionId: session._id,
        });
        appointmentId = appointment._id.toString();
        matchedDoctor = doctor;
        this.logger.log(
          `Call ${session.vapiCallId} -> appointment ${appointmentId}` +
            (doctor ? ` matched to ${doctor.name} (${doctor.specialty})` : ''),
        );
      }

      const certificate = await this.requestCertificateFromCall(
        patientId,
        language,
        summary.requestedCertificate,
      );

      await this.verificationService.create({
        taskType: 'call-note',
        refId: session._id,
        patient: patientId,
        aiOutput: { summary },
      });

      await this.recordCallInConversation(patientId, session, {
        summary,
        matchedDoctor,
        appointmentId,
        certificateType: certificate?.type,
      });

      return {
        linked: true,
        appointmentId,
        matchedDoctor,
        certificateId: certificate?._id.toString(),
      };
    } catch (error) {
      this.logger.error('processCompletedCall failed', error as Error);
      return { linked: false, error: 'triage-failed' };
    }
  }

  /** Web calls arrive pre-linked via the JWT; phone calls resolve by number. */
  private async resolvePatient(
    session: CallSessionDocument,
  ): Promise<string | null> {
    if (session.patient) return session.patient.toString();

    const phone = session.phoneNumber;
    if (!phone) return null;

    const user = await this.authService.findByPhone(phone);
    if (!user || user.role !== 'patient') return null;

    const patientId = await this.authService.patientIdForUser(
      user._id.toString(),
    );
    return patientId ? patientId.toString() : null;
  }

  /** The voice agent can ask for a certificate; honour it instead of dropping it. */
  private async requestCertificateFromCall(
    patientId: string,
    language: string,
    requested: unknown,
  ) {
    const asked = requested as { type?: string; reason?: string } | null;
    if (!asked?.type) return null;

    const type = CERT_TYPES.includes(asked.type as CertificateType)
      ? (asked.type as CertificateType)
      : 'medical';

    return this.certificatesService.request({
      patientId,
      type,
      language,
      details: { reason: asked.reason ?? '', source: 'voice-call' },
    });
  }

  /** Puts the call outcome into the patient's chat thread. */
  private async recordCallInConversation(
    patientId: string,
    session: CallSessionDocument,
    outcome: {
      summary: Record<string, unknown>;
      matchedDoctor: { name: string; specialty: string } | null;
      appointmentId?: string;
      certificateType?: string;
    },
  ) {
    const conversation = await this.conversationsService.getOrCreate(patientId);
    const symptoms = asStringArray(outcome.summary.symptoms);

    const body = [
      `📞 Call summary: ${String(outcome.summary.summary ?? 'Call completed.')}`,
      symptoms.length ? `Symptoms noted: ${symptoms.join(', ')}` : '',
      outcome.summary.urgency ? `Urgency: ${outcome.summary.urgency}` : '',
      outcome.matchedDoctor
        ? `You have been matched with Dr. ${outcome.matchedDoctor.name} (${outcome.matchedDoctor.specialty}), who will confirm and call you back.`
        : outcome.appointmentId
          ? 'A call-back has been requested and a doctor will pick it up shortly.'
          : '',
      outcome.certificateType
        ? `A ${outcome.certificateType} certificate draft was created and is awaiting doctor verification.`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    await this.conversationsService.addMessage(
      conversation._id,
      'assistant',
      body,
      [],
      {
        source: 'call',
        callSessionId: session._id.toString(),
        appointmentId: outcome.appointmentId,
      },
    );
  }

  async listForPatient(patientId: string | Types.ObjectId) {
    return this.callModel
      .find(idFilter('patient', patientId))
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async listAll() {
    return this.callModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('patient')
      .lean()
      .exec();
  }
}
