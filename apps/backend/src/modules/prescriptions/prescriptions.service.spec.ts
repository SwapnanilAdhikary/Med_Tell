import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { PrescriptionsService } from './prescriptions.service';
import { Prescription } from './schemas/prescription.schema';
import { AiService } from '../ai/ai.service';
import { VerificationService } from '../verification/verification.service';
import { PatientsService } from '../patients/patients.service';
import { DoctorsService } from '../doctors/doctors.service';
import { NotificationsService } from '../notifications/notifications.service';

const PATIENT = {
  _id: 'patient-1',
  user: 'user-1',
  name: 'Sita Devi',
  language: 'bn',
  healthProfile: { allergies: [], conditions: [], medications: [] },
};

describe('PrescriptionsService', () => {
  let service: PrescriptionsService;

  const prescriptionModel = {
    create: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const aiService = { draftPrescriptionCouncil: jest.fn() };
  const verificationService = { create: jest.fn() };
  const patientsService = { findById: jest.fn() };
  const doctorsService = { findById: jest.fn() };
  const notificationsService = { create: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    patientsService.findById.mockResolvedValue({ ...PATIENT });
    aiService.draftPrescriptionCouncil.mockResolvedValue({
      items: [
        {
          name: 'Paracetamol',
          dose: '500 mg',
          frequency: '1 tab 3x daily',
          durationDays: 5,
          tpgList: 'A',
        },
        { name: 'ORS', instructions: 'after each loose motion' },
      ],
      flags: [],
      failedRoles: [],
      advice: 'Rest and fluids.',
      summary: 'Simple gastroenteritis.',
    });
    prescriptionModel.create.mockImplementation(async (doc: object) => ({
      ...doc,
      _id: 'rx-1',
    }));
    verificationService.create.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrescriptionsService,
        {
          provide: getModelToken(Prescription.name),
          useValue: prescriptionModel,
        },
        { provide: AiService, useValue: aiService },
        { provide: VerificationService, useValue: verificationService },
        { provide: PatientsService, useValue: patientsService },
        { provide: DoctorsService, useValue: doctorsService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(PrescriptionsService);
  });

  describe('request', () => {
    it('freezes draftItems so the AI proposal is an immutable audit record', async () => {
      await service.request({ patientId: 'patient-1' });

      const created = prescriptionModel.create.mock.calls[0][0] as {
        draftItems: unknown[];
      };
      expect(Object.isFrozen(created.draftItems)).toBe(true);
      for (const item of created.draftItems) {
        expect(Object.isFrozen(item)).toBe(true);
      }
    });

    it('strips nulls from council items so only real facts persist', async () => {
      aiService.draftPrescriptionCouncil.mockResolvedValue({
        items: [
          {
            name: 'Paracetamol',
            dose: '500 mg',
            frequency: null,
            durationDays: null,
            tpgList: 'A',
          },
        ],
        flags: [],
        failedRoles: [],
      });

      await service.request({ patientId: 'patient-1' });

      const created = prescriptionModel.create.mock.calls[0][0] as {
        draftItems: Array<Record<string, unknown>>;
      };
      expect(created.draftItems[0]).toEqual({
        name: 'Paracetamol',
        dose: '500 mg',
        tpgList: 'A',
      });
    });

    it('creates a taskType prescription verification task for the doctor', async () => {
      await service.request({ patientId: 'patient-1' });

      expect(verificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          taskType: 'prescription',
          refId: 'rx-1',
          patient: 'patient-1',
        }),
      );
    });

    it('denormalises the render model and council output for the doctor queue', async () => {
      await service.request({
        patientId: 'patient-1',
        consultMode: 'teleconsult',
        render: {
          reportedBy: { workerName: 'Anjali Roy', cadre: 'ASHA' },
          vitals: { temperatureC: 38.5 },
        },
      });

      const aiOutput = verificationService.create.mock.calls[0][0]
        .aiOutput as Record<string, unknown>;
      expect(aiOutput.type).toBe('prescription');
      expect(aiOutput.subject).toMatchObject({ name: 'Sita Devi' });
      expect(aiOutput.reportedBy).toEqual({
        workerName: 'Anjali Roy',
        cadre: 'ASHA',
      });
      expect((aiOutput.draftItems as unknown[]).length).toBe(2);
    });
  });

  describe('issue', () => {
    const DRAFT = [
      { name: 'Paracetamol', dose: '500 mg', durationDays: 5 },
    ] as never[];
    const DOCTOR = {
      _id: 'doctor-1',
      name: 'Kavita Ghosh',
      specialty: 'Obstetrics',
      registrationNumber: 'WBMC-2019-0001',
    };

    function issuable() {
      const rx = {
        _id: 'rx-1',
        patient: 'patient-1',
        consultMode: 'teleconsult',
        draftItems: DRAFT,
        flags: [],
        councilOutput: { subject: { ageYears: 34, gender: 'female' } },
        save: jest.fn().mockResolvedValue(undefined),
      };
      prescriptionModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(rx),
      });
      return rx as unknown as Record<string, unknown> & { save: jest.Mock };
    }

    it('signs draftItems when the doctor made no edit', async () => {
      const rx = issuable();
      doctorsService.findById.mockResolvedValue(DOCTOR);

      await service.issue('rx-1', 'doctor-1');

      expect(rx.items).toBe(DRAFT);
      expect(rx.status).toBe('issued');
      expect(rx.signedBy).toContain('WBMC-2019-0001');
    });

    it('tells the patient when they have a reachable account', async () => {
      issuable();
      doctorsService.findById.mockResolvedValue(DOCTOR);

      await service.issue('rx-1', 'doctor-1');

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'user-1',
          title: 'Your prescription is ready',
        }),
      );
    });

    it('tells the worker instead when the subject has no account to log into', async () => {
      const rx = issuable();
      rx.notifyUser = 'worker-user-1';
      doctorsService.findById.mockResolvedValue(DOCTOR);

      await service.issue('rx-1', 'doctor-1');

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'worker-user-1',
          title: 'Prescription signed for Sita Devi',
        }),
      );
    });

    it('signs the edit and leaves draftItems untouched - that pair is the training record', async () => {
      const rx = issuable();
      doctorsService.findById.mockResolvedValue(DOCTOR);
      const items = [{ name: 'Amoxicillin', dose: '250 mg' }] as never[];

      await service.issue('rx-1', 'doctor-1', { items });

      expect(rx.items).toEqual(items);
      expect(rx.items).not.toBe(items); // copied, not aliased
      expect(rx.draftItems).toBe(DRAFT);
    });

    it('strips the nulls class-transformer materialises on unset edit fields', async () => {
      const rx = issuable();
      doctorsService.findById.mockResolvedValue(DOCTOR);

      await service.issue('rx-1', 'doctor-1', {
        items: [
          {
            name: 'Zinc sulphate',
            dose: '20 mg',
            frequency: null,
            durationDays: null,
            instructions: null,
            tpgList: null,
          },
        ] as never[],
      });

      expect(rx.items).toEqual([{ name: 'Zinc sulphate', dose: '20 mg' }]);
    });

    it('warns but does not block when the doctor signs a prohibited drug', async () => {
      const rx = issuable();
      doctorsService.findById.mockResolvedValue(DOCTOR);

      await service.issue('rx-1', 'doctor-1', {
        items: [{ name: 'Tramadol' }] as never[],
      });

      expect(rx.status).toBe('issued');
      expect(rx.flags).toEqual([
        expect.objectContaining({ severity: 'warn', itemName: 'Tramadol' }),
      ]);
    });

    it('throws and saves nothing when the doctor has no registration number', async () => {
      const rx = issuable();
      doctorsService.findById.mockResolvedValue({
        ...DOCTOR,
        registrationNumber: '  ',
      });

      await expect(service.issue('rx-1', 'doctor-1')).rejects.toThrow(
        /registration number/,
      );

      expect(rx.save).not.toHaveBeenCalled();
      expect(rx.status).toBeUndefined();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('pdfPath', () => {
    it('returns the path for the owning patient', async () => {
      prescriptionModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'rx-1',
          patient: 'patient-1',
          pdfPath: '/tmp/rx-1.pdf',
        }),
      });

      expect(await service.pdfPath('rx-1', 'patient-1')).toBe('/tmp/rx-1.pdf');
    });

    it('404s on another patient, not 403 - the id must not be confirmed', async () => {
      prescriptionModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'rx-9',
          patient: 'patient-2',
          pdfPath: '/tmp/rx-9.pdf',
        }),
      });

      await expect(service.pdfPath('rx-9', 'patient-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s before issuance', async () => {
      prescriptionModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'rx-1',
          patient: 'patient-1',
          pdfPath: undefined,
        }),
      });

      await expect(service.pdfPath('rx-1', 'patient-1')).rejects.toThrow(
        'Prescription not yet issued',
      );
    });
  });
});
