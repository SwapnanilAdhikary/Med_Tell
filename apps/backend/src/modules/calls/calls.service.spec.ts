import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { CallsService } from './calls.service';
import { CallSession } from './schemas/call-session.schema';
import { AiService } from '../ai/ai.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { VerificationService } from '../verification/verification.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PatientsService } from '../patients/patients.service';
import { CertificatesService } from '../certificates/certificates.service';
import { AuthService } from '../auth/auth.service';

const SUMMARY = {
  summary: 'Caller reports chest pain and breathlessness for two days.',
  symptoms: ['chest pain', 'breathlessness'],
  urgency: 'urgent',
  recommendedAction: 'book_consultation',
  suggestedSpecialty: 'Cardiology',
  requestedCertificate: null as unknown,
};

describe('CallsService', () => {
  let service: CallsService;

  const callModel = { findOneAndUpdate: jest.fn(), find: jest.fn() };
  const aiService = { summarizeCall: jest.fn() };
  const appointmentsService = { book: jest.fn() };
  const verificationService = { create: jest.fn() };
  const conversationsService = {
    getOrCreate: jest.fn(),
    addMessage: jest.fn(),
  };
  const patientsService = { findById: jest.fn() };
  const certificatesService = { request: jest.fn() };
  const authService = {
    findByPhone: jest.fn(),
    patientIdForUser: jest.fn(),
    findOrCreatePatientByPhone: jest.fn(),
  };

  /** A saved CallSession doc as the model would hand it back. */
  function session(overrides: Record<string, unknown> = {}) {
    return {
      _id: 'session-1',
      vapiCallId: 'vapi-1',
      transcriptText: 'assistant: hello\nuser: my chest hurts',
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  function upsertReturns(doc: unknown) {
    callModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    aiService.summarizeCall.mockResolvedValue({ ...SUMMARY });
    patientsService.findById.mockResolvedValue({
      _id: 'patient-1',
      name: 'Priya Sharma',
      language: 'hi',
      user: 'user-1',
    });
    appointmentsService.book.mockResolvedValue({
      appointment: { _id: 'appt-1', status: 'requested' },
      doctor: { id: 'doc-1', name: 'Rohan Mehta', specialty: 'Cardiology' },
    });
    conversationsService.getOrCreate.mockResolvedValue({ _id: 'conv-1' });
    conversationsService.addMessage.mockResolvedValue({});
    verificationService.create.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: getModelToken(CallSession.name), useValue: callModel },
        { provide: ConfigService, useValue: { get: () => '' } },
        { provide: AiService, useValue: aiService },
        { provide: AppointmentsService, useValue: appointmentsService },
        { provide: VerificationService, useValue: verificationService },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: PatientsService, useValue: patientsService },
        { provide: CertificatesService, useValue: certificatesService },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    service = module.get(CallsService);
  });

  describe('completeWebCall', () => {
    it('links the call to the caller from the JWT, not a phone number', async () => {
      const doc = session({ patient: 'patient-1' });
      upsertReturns(doc);

      await service.completeWebCall('patient-1', {
        vapiCallId: 'vapi-1',
        transcript: [{ role: 'user', content: 'my chest hurts' }],
      });

      expect(callModel.findOneAndUpdate).toHaveBeenCalledWith(
        { vapiCallId: 'vapi-1' },
        expect.objectContaining({ patient: 'patient-1', source: 'web' }),
        expect.objectContaining({ upsert: true }),
      );
      // No phone lookup at all - this is what made web calls inert before.
      expect(authService.findByPhone).not.toHaveBeenCalled();
    });

    it('builds transcriptText from the turns when the client sends none', async () => {
      upsertReturns(session({ patient: 'patient-1' }));

      await service.completeWebCall('patient-1', {
        vapiCallId: 'vapi-1',
        transcript: [
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: 'my chest hurts' },
        ],
      });

      const [, update] = callModel.findOneAndUpdate.mock.calls[0];
      expect(update.transcriptText).toBe(
        'assistant: hello\nuser: my chest hurts',
      );
    });

    it('routes the patient brief to the matched specialty and reports it back', async () => {
      upsertReturns(session({ patient: 'patient-1' }));

      const outcome = await service.completeWebCall('patient-1', {
        vapiCallId: 'vapi-1',
        transcript: [{ role: 'user', content: 'my chest hurts' }],
      });

      expect(appointmentsService.book).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'patient-1',
          specialty: 'Cardiology',
          symptoms: ['chest pain', 'breathlessness'],
          urgency: 'urgent',
          callSessionId: 'session-1',
        }),
      );
      expect(outcome).toEqual(
        expect.objectContaining({
          linked: true,
          appointmentId: 'appt-1',
          matchedDoctor: expect.objectContaining({ name: 'Rohan Mehta' }),
        }),
      );
    });

    it("summarises in the patient's own language", async () => {
      upsertReturns(session({ patient: 'patient-1' }));

      await service.completeWebCall('patient-1', { vapiCallId: 'vapi-1' });

      expect(aiService.summarizeCall).toHaveBeenCalledWith(
        expect.any(String),
        'hi',
      );
    });

    it('drops the call outcome into the patient chat thread', async () => {
      upsertReturns(session({ patient: 'patient-1' }));

      await service.completeWebCall('patient-1', { vapiCallId: 'vapi-1' });

      expect(conversationsService.addMessage).toHaveBeenCalledWith(
        'conv-1',
        'assistant',
        expect.stringContaining('Rohan Mehta'),
        [],
        expect.objectContaining({ source: 'call', appointmentId: 'appt-1' }),
      );
    });

    it('queues a call note for doctor verification', async () => {
      upsertReturns(session({ patient: 'patient-1' }));

      await service.completeWebCall('patient-1', { vapiCallId: 'vapi-1' });

      expect(verificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          taskType: 'call-note',
          refId: 'session-1',
          patient: 'patient-1',
        }),
      );
    });

    it('honours a certificate the caller asked for on the phone', async () => {
      aiService.summarizeCall.mockResolvedValue({
        ...SUMMARY,
        requestedCertificate: { type: 'sick-leave', reason: 'two days rest' },
      });
      certificatesService.request.mockResolvedValue({ _id: 'cert-1', type: 'sick-leave' });
      upsertReturns(session({ patient: 'patient-1' }));

      const outcome = await service.completeWebCall('patient-1', {
        vapiCallId: 'vapi-1',
      });

      expect(certificatesService.request).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: 'patient-1', type: 'sick-leave' }),
      );
      expect(outcome.certificateId).toBe('cert-1');
    });

    it('books an urgent case even when the model only recommends self care', async () => {
      aiService.summarizeCall.mockResolvedValue({
        ...SUMMARY,
        recommendedAction: 'self_care',
        urgency: 'urgent',
      });
      upsertReturns(session({ patient: 'patient-1' }));

      await service.completeWebCall('patient-1', { vapiCallId: 'vapi-1' });

      expect(appointmentsService.book).toHaveBeenCalled();
    });

    it('does not book a routine self-care call', async () => {
      aiService.summarizeCall.mockResolvedValue({
        ...SUMMARY,
        recommendedAction: 'self_care',
        urgency: 'routine',
      });
      upsertReturns(session({ patient: 'patient-1' }));

      await service.completeWebCall('patient-1', { vapiCallId: 'vapi-1' });

      expect(appointmentsService.book).not.toHaveBeenCalled();
      // A doctor still sees the note.
      expect(verificationService.create).toHaveBeenCalled();
    });

    it('does not double-book when the webhook reports the same call again', async () => {
      upsertReturns(session({ patient: 'patient-1', summary: SUMMARY }));

      const outcome = await service.completeWebCall('patient-1', {
        vapiCallId: 'vapi-1',
      });

      expect(aiService.summarizeCall).not.toHaveBeenCalled();
      expect(appointmentsService.book).not.toHaveBeenCalled();
      expect(outcome).toEqual(
        expect.objectContaining({ alreadyProcessed: true }),
      );
    });
  });

  describe('handleWebhook', () => {
    it('resolves a phone caller by number when no patient is linked yet', async () => {
      upsertReturns(session({ phoneNumber: '+919876543210' }));
      authService.findByPhone.mockResolvedValue({
        _id: 'user-1',
        role: 'patient',
      });
      authService.patientIdForUser.mockResolvedValue('patient-1');

      const res = await service.handleWebhook({
        message: {
          type: 'end-of-call-report',
          call: { id: 'vapi-1', phoneNumber: { number: '+919876543210' } },
          transcriptText: 'user: my chest hurts',
        },
      });

      expect(authService.findByPhone).toHaveBeenCalledWith('+919876543210');
      expect(appointmentsService.book).toHaveBeenCalled();
      expect(res).toEqual(expect.objectContaining({ ok: true, linked: true }));
    });

    it('creates a shadow patient for a number nobody has registered', async () => {
      upsertReturns(session({ phoneNumber: '+919700009999' }));
      authService.findByPhone.mockResolvedValue(null);
      authService.findOrCreatePatientByPhone.mockResolvedValue({
        patientId: 'patient-1',
        userId: 'user-9',
        created: true,
      });

      const res = await service.handleWebhook({
        message: {
          type: 'end-of-call-report',
          call: { id: 'vapi-1', phoneNumber: { number: '+919700009999' } },
          transcriptText: 'user: my chest hurts',
        },
      });

      expect(authService.findOrCreatePatientByPhone).toHaveBeenCalledWith(
        '+919700009999',
      );
      expect(res).toEqual(expect.objectContaining({ linked: true }));
    });

    it('does not drop the call silently when the number belongs to a doctor', async () => {
      upsertReturns(session({ phoneNumber: '+919800000001' }));
      authService.findByPhone.mockResolvedValue(null);
      authService.findOrCreatePatientByPhone.mockRejectedValue(
        new ConflictException('Phone number belongs to a doctor account'),
      );

      const res = await service.handleWebhook({
        message: {
          type: 'end-of-call-report',
          call: { id: 'vapi-1', phoneNumber: { number: '+919800000001' } },
          transcriptText: 'user: hello',
        },
      });

      expect(res).toEqual(expect.objectContaining({ linked: false }));
      expect(aiService.summarizeCall).not.toHaveBeenCalled();
    });

    it('skips triage when the call cannot be tied to a patient', async () => {
      upsertReturns(session({}));

      const res = await service.handleWebhook({
        message: {
          type: 'end-of-call-report',
          call: { id: 'vapi-1' },
          transcriptText: 'user: hello',
        },
      });

      expect(aiService.summarizeCall).not.toHaveBeenCalled();
      expect(res).toEqual(expect.objectContaining({ linked: false }));
    });

    it('does not clobber a transcript the browser already posted', async () => {
      upsertReturns(session({ patient: 'patient-1' }));

      await service.handleWebhook({
        message: {
          type: 'end-of-call-report',
          call: { id: 'vapi-1' },
          transcript: [],
          transcriptText: '',
        },
      });

      const [, update] = callModel.findOneAndUpdate.mock.calls[0];
      expect(update).not.toHaveProperty('transcript');
      expect(update).not.toHaveProperty('transcriptText');
    });
  });
});
