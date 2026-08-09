import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { AiService } from '../ai/ai.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PatientsService } from '../patients/patients.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { CertificatesService } from '../certificates/certificates.service';
import { DocumentsService } from '../documents/documents.service';
import { DoctorsService } from '../doctors/doctors.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from '../auth/auth.service';

const PATIENT = {
  _id: 'patient-1',
  user: 'user-1',
  name: 'Sita Devi',
  language: 'bn',
};
const DOCTOR = { _id: 'doctor-1', user: 'duser-1', name: 'Kavita Ghosh' };

describe('ChatService handoff', () => {
  let service: ChatService;

  const aiService = { runAgent: jest.fn() };
  const conversationsService = {
    getOrCreate: jest.fn(),
    addMessage: jest.fn(),
    history: jest.fn(),
    setHandoff: jest.fn(),
    listMessages: jest.fn(),
    setLanguage: jest.fn(),
  };
  const patientsService = { findById: jest.fn(), update: jest.fn() };
  const doctorsService = { findById: jest.fn() };
  const notificationsService = { create: jest.fn() };
  const authService = {
    findUserById: jest.fn().mockResolvedValue({ phone: '+919876543211' }),
  };

  /** The messages that were appended, in order. */
  const added = () => conversationsService.addMessage.mock.calls;

  function conversation(over: Record<string, unknown> = {}) {
    conversationsService.getOrCreate.mockResolvedValue({
      _id: 'conv-1',
      language: 'bn',
      ...over,
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    patientsService.findById.mockResolvedValue({ ...PATIENT });
    doctorsService.findById.mockResolvedValue({ ...DOCTOR });
    conversationsService.addMessage.mockResolvedValue({ _id: 'msg-1' });
    conversationsService.history.mockResolvedValue([]);
    conversationsService.setHandoff.mockResolvedValue({
      handoffAt: new Date(),
      handoffDoctor: 'doctor-1',
    });
    aiService.runAgent.mockResolvedValue({
      reply: 'agent said this',
      actions: [],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: AiService, useValue: aiService },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: PatientsService, useValue: patientsService },
        { provide: AppointmentsService, useValue: {} },
        { provide: CertificatesService, useValue: {} },
        { provide: DocumentsService, useValue: {} },
        { provide: DoctorsService, useValue: doctorsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    service = module.get(ChatService);
  });

  it('runs the agent as usual when no doctor has taken over', async () => {
    conversation();

    const result = await service.sendMessage('patient-1', 'my head hurts');

    expect(aiService.runAgent).toHaveBeenCalled();
    expect(result.reply).toBe('agent said this');
  });

  it('does NOT run the agent while a doctor holds the thread', async () => {
    // The safety property of this PR: an assistant answering over a live
    // clinician can contradict them.
    conversation({ handoffAt: new Date(), handoffDoctor: 'doctor-1' });

    const result = await service.sendMessage(
      'patient-1',
      'should I take more?',
    );

    expect(aiService.runAgent).not.toHaveBeenCalled();
    expect(result.handoff).toBe(true);
  });

  it('still stores the patient message and answers in their language', async () => {
    conversation({ handoffAt: new Date(), handoffDoctor: 'doctor-1' });

    const result = await service.sendMessage(
      'patient-1',
      'should I take more?',
    );

    expect(added()[0][1]).toBe('user');
    expect(added()[0][2]).toBe('should I take more?');
    // Bengali, because the conversation is bn - not an English fallback.
    expect(result.reply).toContain('ডাক্তার');
  });

  it('tells the holding doctor that the patient replied', async () => {
    conversation({ handoffAt: new Date(), handoffDoctor: 'doctor-1' });

    await service.sendMessage('patient-1', 'should I take more?');

    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'duser-1', type: 'chat' }),
    );
  });

  it('does not fall over when the holding doctor no longer exists', async () => {
    conversation({ handoffAt: new Date(), handoffDoctor: 'doctor-gone' });
    doctorsService.findById.mockRejectedValue(new Error('not found'));

    await expect(
      service.sendMessage('patient-1', 'hello'),
    ).resolves.toMatchObject({ handoff: true });
  });

  describe('doctorMessage', () => {
    it('stores as assistant with the author in metadata, not a doctor role', async () => {
      conversation();

      await service.doctorMessage('doctor-1', 'patient-1', 'Come in tomorrow.');

      const [, role, content, , metadata] = added()[0];
      expect(role).toBe('assistant');
      expect(content).toBe('Come in tomorrow.');
      expect(metadata).toEqual({
        author: 'doctor',
        doctorId: 'doctor-1',
        doctorName: 'Kavita Ghosh',
      });
    });

    it('notifies the patient that a doctor replied', async () => {
      conversation();

      await service.doctorMessage('doctor-1', 'patient-1', 'Come in tomorrow.');

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'user-1',
          title: 'Dr. Kavita Ghosh replied',
        }),
      );
    });
  });

  describe('setHandoff', () => {
    it('releases by clearing the doctor, so the agent answers again', async () => {
      conversationsService.setHandoff.mockResolvedValue({});

      await service.setHandoff(undefined, 'patient-1', false);

      expect(conversationsService.setHandoff).toHaveBeenCalledWith(
        'patient-1',
        undefined,
      );
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'A doctor has left your chat' }),
      );
    });
  });
});
