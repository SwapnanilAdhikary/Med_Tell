import { Injectable } from '@nestjs/common';
import { AiService, PatientContext } from '../ai/ai.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PatientsService } from '../patients/patients.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { CertificatesService } from '../certificates/certificates.service';
import { DocumentsService } from '../documents/documents.service';
import { DoctorsService } from '../doctors/doctors.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from '../auth/auth.service';
import type { CertificateType } from '../certificates/schemas/certificate.schema';

/**
 * Populated-or-not doctor ref -> a label the model can quote verbatim.
 * `title` is a qualification ("MBBS, MD"), not an honorific, so "Dr." is added.
 */
function doctorLabelOf(doctor: unknown): string | null {
  const d = doctor as { name?: string; specialty?: string };
  if (!d?.name) return null;
  return `Dr. ${d.name}${d.specialty ? ` (${d.specialty})` : ''}`;
}

/** Fixed, translated, and never model-generated: the AI is off duty here. */
const HANDOFF_REPLY: Record<string, string> = {
  en: 'A doctor is reviewing this conversation and will reply here themselves. Your message has been passed to them.',
  hi: 'एक डॉक्टर इस बातचीत को देख रहे हैं और यहीं आपको खुद जवाब देंगे। आपका संदेश उन्हें भेज दिया गया है।',
  bn: 'একজন ডাক্তার এই কথাবার্তা দেখছেন এবং এখানেই নিজে উত্তর দেবেন। আপনার বার্তা তাঁকে পাঠানো হয়েছে।',
};

@Injectable()
export class ChatService {
  constructor(
    private readonly aiService: AiService,
    private readonly conversationsService: ConversationsService,
    private readonly patientsService: PatientsService,
    private readonly appointmentsService: AppointmentsService,
    private readonly certificatesService: CertificatesService,
    private readonly documentsService: DocumentsService,
    private readonly doctorsService: DoctorsService,
    private readonly notificationsService: NotificationsService,
    private readonly authService: AuthService,
  ) {}

  async sendMessage(patientId: string, userText: string) {
    const patient = await this.patientsService.findById(patientId);
    const conversation = await this.conversationsService.getOrCreate(patientId);

    await this.conversationsService.addMessage(
      conversation._id,
      'user',
      userText,
    );

    // A doctor is on this thread, so the agent stays out of it: store the
    // message, tell the doctor, and answer with a fixed line. Running the agent
    // here would have it contradicting a live clinician.
    if (conversation.handoffAt) {
      const language = conversation.language ?? patient.language ?? 'en';
      const reply = HANDOFF_REPLY[language] ?? HANDOFF_REPLY.en;
      await this.notifyHandoffDoctor(conversation, patient.name, userText);
      await this.conversationsService.addMessage(
        conversation._id,
        'assistant',
        reply,
        [],
        { handoff: true },
      );
      return {
        reply,
        actions: [],
        conversationId: conversation._id.toString(),
        handoff: true,
      };
    }

    const history = await this.conversationsService.history(conversation._id);

    const context: PatientContext = {
      name: patient.name,
      language: conversation.language ?? patient.language ?? 'en',
      allergies: patient.healthProfile?.allergies,
      conditions: patient.healthProfile?.conditions,
      medications: patient.healthProfile?.medications,
    };

    // Tools run inside the agent loop, so the model sees the real outcome
    // (appointment id, matched doctor, failures) before it writes its reply.
    const result = await this.aiService.runAgent(
      context,
      history.slice(0, -1),
      userText,
      (name, args) => this.executeAction(patientId, name, args),
    );

    const actions = result.actions.map((a) => ({
      name: a.name,
      args: a.args,
      result: a.result,
    }));

    await this.conversationsService.addMessage(
      conversation._id,
      'assistant',
      result.reply,
      [],
      { actions },
    );

    return {
      reply: result.reply,
      actions,
      conversationId: conversation._id.toString(),
    };
  }

  /**
   * A report uploaded from the chat screen. Goes through the same analyze path
   * as the Reports screen (image never stored), then lands in the conversation
   * as an attachment so the agent can talk about it.
   */
  async sendDocument(patientId: string, file: Express.Multer.File) {
    const patient = await this.patientsService.findById(patientId);
    const conversation = await this.conversationsService.getOrCreate(patientId);
    const language = conversation.language ?? patient.language ?? 'en';

    // Throws 422 if the AI read nothing — the patient sees that in chat.
    const doc = await this.documentsService.analyzeUpload(
      patientId,
      file,
      language,
    );
    const findings = doc.aiFindings;

    await this.conversationsService.addMessage(
      conversation._id,
      'user',
      `I've uploaded my report: ${doc.filename}`,
      [
        {
          kind: 'medical-document',
          id: doc._id.toString(),
          name: doc.filename,
          mimeType: doc.mimeType,
        },
      ],
    );

    const history = await this.conversationsService.history(conversation._id);
    const context: PatientContext = {
      name: patient.name,
      language,
      allergies: patient.healthProfile?.allergies,
      conditions: patient.healthProfile?.conditions,
      medications: patient.healthProfile?.medications,
    };

    const prompt = `The patient just uploaded a medical report called "${doc.filename}". The AI analysis found:
Summary: ${findings?.summary ?? 'none'}
Abnormal findings: ${(findings?.abnormalFindings ?? []).join('; ') || 'none'}
Confidence: ${findings?.confidence ?? 0}

Acknowledge the report, explain the findings in plain language, and remind them a doctor still has to verify it. Offer to book a consultation if anything looks abnormal.`;

    const result = await this.aiService.runAgent(
      context,
      history.slice(0, -1),
      prompt,
      (name, args) => this.executeAction(patientId, name, args),
    );

    const actions = result.actions.map((a) => ({
      name: a.name,
      args: a.args,
      result: a.result,
    }));

    await this.conversationsService.addMessage(
      conversation._id,
      'assistant',
      result.reply,
      [],
      { actions },
    );

    return {
      reply: result.reply,
      actions,
      document: doc,
      conversationId: conversation._id.toString(),
    };
  }

  /**
   * A doctor writes into the patient's thread. Stored as `assistant` with
   * `metadata.author` rather than a new 'doctor' role: history() filters to
   * user/assistant, so a 'doctor' role would be silently dropped and the model
   * left blind to the doctor's own words.
   */
  async doctorMessage(doctorId: string, patientId: string, text: string) {
    const doctor = await this.doctorsService.findById(doctorId);
    const patient = await this.patientsService.findById(patientId);
    const conversation = await this.conversationsService.getOrCreate(patientId);

    const message = await this.conversationsService.addMessage(
      conversation._id,
      'assistant',
      text,
      [],
      { author: 'doctor', doctorId, doctorName: doctor.name },
    );

    await this.notificationsService.create({
      user: patient.user,
      title: `Dr. ${doctor.name} replied`,
      body: text.slice(0, 200),
      type: 'chat',
      ref: { conversationId: conversation._id.toString() },
    });

    return { message, conversationId: conversation._id.toString() };
  }

  /** Take the thread over, or hand it back to the assistant. */
  async setHandoff(
    doctorId: string | undefined,
    patientId: string,
    on: boolean,
  ) {
    const patient = await this.patientsService.findById(patientId);
    const conversation = await this.conversationsService.setHandoff(
      patientId,
      on ? doctorId : undefined,
    );

    const doctorName = doctorId
      ? (await this.doctorsService.findById(doctorId)).name
      : '';
    await this.notificationsService.create({
      user: patient.user,
      title: on
        ? 'A doctor has joined your chat'
        : 'A doctor has left your chat',
      body: on
        ? `Dr. ${doctorName} is reading this conversation and will answer you directly. The assistant will not reply until they are done.`
        : 'Your chat is back with the MedAssist assistant. A doctor has finished reviewing it.',
      type: 'chat',
      ref: { patientId },
    });

    return {
      handoffAt: conversation?.handoffAt ?? null,
      handoffDoctor: conversation?.handoffDoctor ?? null,
    };
  }

  private async notifyHandoffDoctor(
    conversation: { handoffDoctor?: unknown; _id: unknown },
    patientName: string,
    text: string,
  ) {
    if (!conversation.handoffDoctor) return;
    const doctor = await this.doctorsService
      .findById(String(conversation.handoffDoctor))
      .catch(() => null);
    if (!doctor) return;
    await this.notificationsService.create({
      user: doctor.user,
      title: `${patientName} replied in your chat`,
      body: text.slice(0, 200),
      type: 'chat',
      ref: { conversationId: String(conversation._id) },
    });
  }

  async getMessages(patientId: string) {
    const conversation = await this.conversationsService.getOrCreate(patientId);
    const messages = await this.conversationsService.listMessages(
      conversation._id,
    );
    const patient = await this.patientsService.findById(patientId);
    const login = await this.patientLogin(patient.user);
    return {
      conversationId: conversation._id.toString(),
      language: conversation.language,
      // Named, so a doctor can never write into the wrong person's thread
      // without seeing it. Two patients can share a first name, and a
      // mistyped phone silently creates a second record.
      patient: {
        _id: String(patient._id),
        name: patient.name,
        login,
        // A worker-reported villager with no phone has no login, so nothing
        // written here will ever be read.
        reachable: !!login && !login.startsWith('local:'),
      },
      handoffAt: conversation.handoffAt ?? null,
      messages,
    };
  }

  private async patientLogin(userId: unknown): Promise<string> {
    const user = await this.authService.findUserById(String(userId));
    return user?.phone ?? '';
  }

  async setLanguage(patientId: string, language: string) {
    const supported = ['en', 'hi', 'bn'];
    const selected = supported.includes(language) ? language : 'en';
    await this.conversationsService.setLanguage(patientId, selected);
    await this.patientsService.update(patientId, { language: selected });
    return { language: selected };
  }

  /**
   * Runs one tool for real. The return value goes straight back to the model as
   * the tool result, so everything here must describe what actually happened.
   */
  private async executeAction(
    patientId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    switch (name) {
      case 'book_consultation': {
        const { appointment, doctor } = await this.appointmentsService.book({
          patientId,
          reason: String(args.reason ?? ''),
          preferredWindow: args.preferredWindow
            ? String(args.preferredWindow)
            : undefined,
          bestContactNumber: args.bestContactNumber
            ? String(args.bestContactNumber)
            : undefined,
          specialty: args.specialty ? String(args.specialty) : undefined,
        });
        return {
          appointmentId: appointment._id.toString(),
          status: appointment.status,
          preferredWindow: appointment.callBackJob?.preferredWindow ?? null,
          suggestedDoctor: doctor,
        };
      }
      case 'request_certificate': {
        const type = String(args.type ?? 'medical') as CertificateType;
        const certificate = await this.certificatesService.request({
          patientId,
          type,
          language: args.language ? String(args.language) : 'en',
          details: (args.details as Record<string, unknown>) ?? {},
        });
        return {
          certificateId: certificate._id.toString(),
          type: certificate.type,
          status: certificate.status,
          note: 'A doctor must verify this draft before it can be downloaded.',
        };
      }
      case 'emergency': {
        const patient = await this.patientsService.findById(patientId);
        await this.notificationsService.create({
          user: patient.user,
          title: 'Emergency guidance issued',
          body: `Concern reported: ${String(args.concern ?? '')}. If this is a medical emergency, call 112 (or 108 for an ambulance) immediately.`,
          type: 'system',
          ref: { concern: args.concern },
        });
        return { emergency: true, emergencyNumbers: ['112', '108'] };
      }
      case 'set_language': {
        const language = String(args.language ?? 'en');
        await this.conversationsService.setLanguage(patientId, language);
        await this.patientsService.update(patientId, { language });
        return { language };
      }
      case 'get_my_records': {
        const [appointments, certificates, documents] = await Promise.all([
          this.appointmentsService.listForPatient(patientId),
          this.certificatesService.listForPatient(patientId),
          this.documentsService.listForPatient(patientId),
        ]);
        return {
          appointments: appointments.slice(0, 10).map((a) => ({
            id: a._id.toString(),
            status: a.status,
            reason: a.reason,
            requestedAt: a.createdAt,
            doctor: doctorLabelOf(a.doctor ?? a.suggestedDoctor),
            confirmed: Boolean(a.doctor),
            preferredWindow: a.callBackJob?.preferredWindow,
            consultNotes: a.callBackJob?.consultNotes,
          })),
          certificates: certificates.slice(0, 10).map((c) => ({
            id: c._id.toString(),
            type: c.type,
            status: c.status,
            issuedAt: c.issuedAt,
            rejectReason: c.rejectReason,
            downloadable: c.status === 'issued',
          })),
          documents: documents.slice(0, 10).map((d) => ({
            id: d._id.toString(),
            filename: d.filename,
            status: d.status,
            aiSummary: d.aiFindings?.summary,
          })),
        };
      }
      case 'find_doctor': {
        const specialty = args.specialty ? String(args.specialty) : undefined;
        const doctors = await this.doctorsService.list({ verified: true });
        const match = await this.doctorsService.findBestMatch(specialty);
        return {
          bestMatch: match
            ? {
                name: match.name,
                title: match.title,
                specialty: match.specialty,
              }
            : null,
          available: doctors.map((d) => ({
            name: d.name,
            title: d.title,
            specialty: d.specialty,
          })),
        };
      }
      default:
        return { error: `Unknown tool "${name}"` };
    }
  }
}
