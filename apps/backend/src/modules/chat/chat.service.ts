import { Injectable } from '@nestjs/common';
import { AiService, PatientContext } from '../ai/ai.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PatientsService } from '../patients/patients.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { CertificatesService } from '../certificates/certificates.service';
import { DocumentsService } from '../documents/documents.service';
import { DoctorsService } from '../doctors/doctors.service';
import { NotificationsService } from '../notifications/notifications.service';
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
  ) {}

  async sendMessage(patientId: string, userText: string) {
    const patient = await this.patientsService.findById(patientId);
    const conversation = await this.conversationsService.getOrCreate(patientId);

    await this.conversationsService.addMessage(
      conversation._id,
      'user',
      userText,
    );
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

  async getMessages(patientId: string) {
    const conversation = await this.conversationsService.getOrCreate(patientId);
    const messages = await this.conversationsService.listMessages(
      conversation._id,
    );
    return {
      conversationId: conversation._id.toString(),
      language: conversation.language,
      messages,
    };
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
