import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CallsService } from './calls.service';
import { CallSession } from './schemas/call-session.schema';
import { AiService } from '../ai/ai.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { VerificationService } from '../verification/verification.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PatientsService } from '../patients/patients.service';
import { CertificatesService } from '../certificates/certificates.service';
import { AuthService } from '../auth/auth.service';
import { HealthWorkersService } from '../health-workers/health-workers.service';
import { DoctorsService } from '../doctors/doctors.service';
import { FacilitiesService } from '../facilities/facilities.service';
import { FieldReportsService } from '../field-reports/field-reports.service';

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

  const callModel = {
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const configGet = jest.fn((_key: string, dflt?: string) => dflt ?? '');
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
  const healthWorkersService = { findById: jest.fn() };
  const doctorsService = { list: jest.fn() };
  const facilitiesService = { findById: jest.fn() };
  const fieldReportsService = { ingestFromCall: jest.fn() };

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
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: AiService, useValue: aiService },
        { provide: AppointmentsService, useValue: appointmentsService },
        { provide: VerificationService, useValue: verificationService },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: PatientsService, useValue: patientsService },
        { provide: CertificatesService, useValue: certificatesService },
        { provide: AuthService, useValue: authService },
        { provide: HealthWorkersService, useValue: healthWorkersService },
        { provide: DoctorsService, useValue: doctorsService },
        { provide: FacilitiesService, useValue: facilitiesService },
        { provide: FieldReportsService, useValue: fieldReportsService },
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
      // A patient call must never reach the field classifier.
      expect(fieldReportsService.ingestFromCall).not.toHaveBeenCalled();
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
      certificatesService.request.mockResolvedValue({
        _id: 'cert-1',
        type: 'sick-leave',
      });
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

  describe('the field call path', () => {
    const WORKER = {
      _id: 'worker-1',
      name: 'Anjali Roy',
      cadre: 'ASHA',
      village: 'Beldanga',
      languages: ['bn', 'hi'],
    };

    beforeEach(() => {
      healthWorkersService.findById.mockResolvedValue({ ...WORKER });
      doctorsService.list.mockResolvedValue([]);
      fieldReportsService.ingestFromCall.mockResolvedValue({
        kind: 'report',
        report: {
          _id: 'report-1',
          matchedDoctor: { name: 'Kavita Ghosh', specialty: 'Obstetrics' },
          subjectReachable: true,
        },
        transcript: 'user: Sita Devi has a fever',
      });
    });

    it('uses the ASHA assistant, not the patient one', async () => {
      const session = await service.getFieldWebSession('worker-1');
      // ConfigService in this spec returns '' for everything, so assert the key.
      expect(configGet).toHaveBeenCalledWith('VAPI_ASHA_ASSISTANT_ID', '');
      expect(configGet).not.toHaveBeenCalledWith('VAPI_ASSISTANT_ID', '');
      expect(session.variableValues).toEqual(
        expect.objectContaining({
          workerName: 'Anjali Roy',
          cadre: 'ASHA',
          village: 'Beldanga',
        }),
      );
    });

    it('greets in the worker language and never asks for their symptoms', async () => {
      const session = await service.getFieldWebSession('worker-1');
      expect(session.language).toBe('bn');
      expect(session.firstMessage).toContain('Anjali');
    });

    it('refuses a token with no worker id', async () => {
      await expect(service.getFieldWebSession(undefined)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('sends the transcript to the field classifier, never to book()', async () => {
      upsertReturns(session({ kind: 'field' }));
      callModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const out = await service.completeFieldWebCall(
        { workerId: 'worker-1', phone: '+919700000001' },
        {
          vapiCallId: 'vapi-f1',
          transcript: [{ role: 'user', content: 'Sita Devi has a fever' }],
          geo: { lat: 23.93, lng: 88.25, picked: true },
        },
      );

      expect(fieldReportsService.ingestFromCall).toHaveBeenCalledWith(
        'worker-1',
        expect.objectContaining({
          geo: { lat: 23.93, lng: 88.25, picked: true },
          workerPhone: '+919700000001',
        }),
      );
      expect(appointmentsService.book).not.toHaveBeenCalled();
      expect(out).toEqual(
        expect.objectContaining({ kind: 'report', reportId: 'report-1' }),
      );
    });

    it('stores the session as a field call with a worker and no patient', async () => {
      upsertReturns(session({ kind: 'field' }));
      callModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await service.completeFieldWebCall(
        { workerId: 'worker-1' },
        { vapiCallId: 'vapi-f1', transcriptText: 'a case' },
      );

      const [filter, update] = callModel.findOneAndUpdate.mock.calls[0];
      // Keyed on kind so a patient can never claim a field call, or the reverse.
      expect(filter).toEqual({ vapiCallId: 'vapi-f1', kind: 'field' });
      expect(update).toEqual(
        expect.objectContaining({ kind: 'field', healthWorker: 'worker-1' }),
      );
      expect(update.patient).toBeUndefined();
    });

    it('refuses to let one worker claim another worker call', async () => {
      callModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ healthWorker: 'worker-9' }),
      });

      await expect(
        service.completeFieldWebCall(
          { workerId: 'worker-1' },
          { vapiCallId: 'vapi-f1', transcriptText: 'a case' },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(fieldReportsService.ingestFromCall).not.toHaveBeenCalled();
    });

    it('reports nothing-heard instead of filing an empty case', async () => {
      upsertReturns(session({ kind: 'field' }));
      callModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const out = await service.completeFieldWebCall(
        { workerId: 'worker-1' },
        { vapiCallId: 'vapi-f1', transcriptText: '   ' },
      );

      expect(out).toEqual({ kind: 'none', reason: 'nothing-heard' });
      expect(fieldReportsService.ingestFromCall).not.toHaveBeenCalled();
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
