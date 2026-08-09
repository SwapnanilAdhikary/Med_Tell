import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { VerificationTask } from './schemas/verification-task.schema';
import { DocumentsService } from '../documents/documents.service';
import { CertificatesService } from '../certificates/certificates.service';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PatientsService } from '../patients/patients.service';
import { NotificationsService } from '../notifications/notifications.service';

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'task-1',
    taskType: 'certificate',
    refId: 'cert-1',
    patient: 'patient-1',
    status: 'pending',
    doctor: undefined,
    doctorComment: undefined,
    reviewedAt: undefined,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('VerificationService', () => {
  let service: VerificationService;

  const taskModel = {
    findById: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
  };
  const documentsService = {
    approve: jest.fn(),
    reject: jest.fn(),
  };
  const certificatesService = {
    issue: jest.fn(),
    reject: jest.fn(),
  };
  const prescriptionsService = {
    issue: jest.fn(),
    reject: jest.fn(),
  };
  const conversationsService = {
    setHandoff: jest.fn().mockResolvedValue({}),
  };
  const patientsService = {
    findById: jest.fn().mockResolvedValue({ user: 'user-1' }),
  };
  const notificationsService = {
    create: jest.fn().mockResolvedValue({}),
  };

  function findByIdReturns(task: Record<string, unknown> | null) {
    taskModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(task),
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: getModelToken(VerificationTask.name), useValue: taskModel },
        { provide: DocumentsService, useValue: documentsService },
        { provide: CertificatesService, useValue: certificatesService },
        { provide: PrescriptionsService, useValue: prescriptionsService },
        { provide: PatientsService, useValue: patientsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ConversationsService, useValue: conversationsService },
      ],
    }).compile();

    service = module.get<VerificationService>(VerificationService);
  });

  describe('approve', () => {
    it('applies the decision and only then marks the task approved', async () => {
      const task = makeTask({ taskType: 'document', refId: 'doc-1' });
      findByIdReturns(task);
      documentsService.approve.mockResolvedValue({});

      const result = (await service.approve(
        'task-1',
        'doctor-1',
        'looks good',
      )) as unknown as Record<string, unknown>;

      expect(documentsService.approve).toHaveBeenCalledWith(
        'doc-1',
        'doctor-1',
        'looks good',
      );
      expect(result.status).toBe('approved');
      expect(result.doctor).toBe('doctor-1');
      expect(task.save).toHaveBeenCalled();
    });

    it('issues the certificate for certificate tasks', async () => {
      const task = makeTask({ taskType: 'certificate', refId: 'cert-1' });
      findByIdReturns(task);
      certificatesService.issue.mockResolvedValue({});

      await service.approve('task-1', 'doctor-1');

      expect(certificatesService.issue).toHaveBeenCalledWith(
        'cert-1',
        'doctor-1',
      );
      expect(task.save).toHaveBeenCalled();
    });

    it('does not save the task as approved when the decision fails', async () => {
      const task = makeTask({ taskType: 'certificate', refId: 'cert-1' });
      findByIdReturns(task);
      certificatesService.issue.mockRejectedValue(new Error('pdf failed'));

      await expect(service.approve('task-1', 'doctor-1')).rejects.toThrow(
        'pdf failed',
      );

      expect(task.status).toBe('pending');
      expect(task.save).not.toHaveBeenCalled();
    });

    it('throws NotFound when the task does not exist', async () => {
      findByIdReturns(null);

      await expect(service.approve('missing', 'doctor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a second decision on an already decided task', async () => {
      const task = makeTask({ status: 'approved', save: jest.fn() });
      findByIdReturns(task);

      await expect(service.approve('task-1', 'doctor-1')).rejects.toThrow(
        ConflictException,
      );

      expect(certificatesService.issue).not.toHaveBeenCalled();
      expect(task.save).not.toHaveBeenCalled();
    });

    it('notifies the patient when a call note is approved', async () => {
      const task = makeTask({ taskType: 'call-note', refId: 'call-1' });
      findByIdReturns(task);

      await service.approve('task-1', 'doctor-1');

      expect(documentsService.approve).not.toHaveBeenCalled();
      expect(certificatesService.issue).not.toHaveBeenCalled();
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ user: 'user-1', type: 'verification' }),
      );
      expect(task.status).toBe('approved');
    });
  });

  describe('prescription tasks', () => {
    const EDIT = {
      items: [{ name: 'Amoxicillin', dose: '500 mg', durationDays: 5 }],
    };

    it('issues with no edit on a plain approve, so issue() falls back to draftItems', async () => {
      const task = makeTask({ taskType: 'prescription', refId: 'rx-1' });
      findByIdReturns(task);
      prescriptionsService.issue.mockResolvedValue({});

      const result = (await service.approve(
        'task-1',
        'doctor-1',
      )) as unknown as Record<string, unknown>;

      expect(prescriptionsService.issue).toHaveBeenCalledWith(
        'rx-1',
        'doctor-1',
        undefined,
      );
      // The catch-all else must not have fired: no "a doctor reviewed your
      // call" for a prescription.
      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(result.status).toBe('approved');
    });

    it('persists doctorEdit, signs the edit, and marks the task edited', async () => {
      const task = makeTask({ taskType: 'prescription', refId: 'rx-1' });
      findByIdReturns(task);
      prescriptionsService.issue.mockResolvedValue({});

      const result = (await service.approveWithEdit(
        'task-1',
        'doctor-1',
        EDIT,
        'swapped the antibiotic',
      )) as unknown as Record<string, unknown>;

      expect(prescriptionsService.issue).toHaveBeenCalledWith(
        'rx-1',
        'doctor-1',
        EDIT,
      );
      expect(result.doctorEdit).toEqual(EDIT);
      expect(result.status).toBe('edited');
      expect(result.doctorComment).toBe('swapped the antibiotic');
    });

    it('leaves the task pending when signing fails, so it can be re-decided', async () => {
      const task = makeTask({ taskType: 'prescription', refId: 'rx-1' });
      findByIdReturns(task);
      prescriptionsService.issue.mockRejectedValue(
        new Error('no registration number'),
      );

      await expect(
        service.approveWithEdit('task-1', 'doctor-1', EDIT),
      ).rejects.toThrow('no registration number');

      expect(task.status).toBe('pending');
      expect(task.save).not.toHaveBeenCalled();
    });

    it('rejects through the prescriptions service, not the catch-all', async () => {
      const task = makeTask({ taskType: 'prescription', refId: 'rx-1' });
      findByIdReturns(task);

      await service.reject('task-1', 'doctor-1', 'wrong drug');

      expect(prescriptionsService.reject).toHaveBeenCalledWith(
        'rx-1',
        'doctor-1',
        'wrong drug',
      );
      // A declined prescription is where the patient needs a person.
      expect(conversationsService.setHandoff).toHaveBeenCalledWith(
        'patient-1',
        'doctor-1',
      );
      expect(task.status).toBe('rejected');
    });

    it('still rejects when opening the handoff fails', async () => {
      const task = makeTask({ taskType: 'prescription', refId: 'rx-1' });
      findByIdReturns(task);
      conversationsService.setHandoff.mockRejectedValue(
        new Error('mongo down'),
      );

      await service.reject('task-1', 'doctor-1', 'wrong drug');

      // The rejection is the medically important half; chat is a convenience.
      expect(task.status).toBe('rejected');
      expect(task.save).toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('rejects a document and saves the task as rejected', async () => {
      const task = makeTask({ taskType: 'document', refId: 'doc-1' });
      findByIdReturns(task);
      documentsService.reject.mockResolvedValue({});

      const result = await service.reject('task-1', 'doctor-1', 'unreadable');

      expect(documentsService.reject).toHaveBeenCalledWith(
        'doc-1',
        'doctor-1',
        'unreadable',
      );
      expect(result.status).toBe('rejected');
      expect(task.save).toHaveBeenCalled();
    });

    it('does not open a chat handoff when rejecting a certificate', async () => {
      const task = makeTask({ taskType: 'certificate', refId: 'cert-1' });
      findByIdReturns(task);

      await service.reject('task-1', 'doctor-1', 'wrong dates');

      expect(conversationsService.setHandoff).not.toHaveBeenCalled();
    });

    it('rejects a certificate', async () => {
      const task = makeTask({ taskType: 'certificate', refId: 'cert-1' });
      findByIdReturns(task);
      certificatesService.reject.mockResolvedValue({});

      await service.reject('task-1', 'doctor-1', 'wrong dates');

      expect(certificatesService.reject).toHaveBeenCalledWith(
        'cert-1',
        'doctor-1',
        'wrong dates',
      );
      expect(task.status).toBe('rejected');
    });
  });

  describe('listPending', () => {
    it('returns only pending tasks with patient populated', async () => {
      const chain = {
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest
          .fn()
          .mockResolvedValue([
            { _id: 'task-1', taskType: 'document', status: 'pending' },
          ]),
      };
      taskModel.find.mockReturnValue(chain);

      const tasks = await service.listPending();

      expect(taskModel.find).toHaveBeenCalledWith({ status: 'pending' });
      expect(tasks).toHaveLength(1);
    });
  });

  describe('summary', () => {
    it('counts tasks by status', async () => {
      taskModel.countDocuments
        .mockResolvedValueOnce(4) // pending
        .mockResolvedValueOnce(2) // approved
        .mockResolvedValueOnce(1) // rejected
        .mockResolvedValueOnce(7); // total

      const summary = await service.summary();

      expect(summary).toEqual({
        pending: 4,
        approved: 2,
        rejected: 1,
        total: 7,
      });
      expect(taskModel.countDocuments).toHaveBeenCalledTimes(4);
    });
  });
});
