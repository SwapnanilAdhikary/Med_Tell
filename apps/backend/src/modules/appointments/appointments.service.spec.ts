import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsService } from './appointments.service';
import { getModelToken } from '@nestjs/mongoose';
import { DoctorsService } from '../doctors/doctors.service';
import { PatientsService } from '../patients/patients.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let appointmentModel: any;

  const mockAppointment = (overrides: Record<string, any> = {}) => ({
    _id: 'apt-1',
    patient: 'pat-1',
    doctor: null,
    status: 'requested',
    callBackJob: { preferredWindow: 'today' },
    save: jest.fn().mockResolvedValue(true),
    populate: jest.fn().mockReturnThis(),
    toObject: jest.fn().mockReturnThis(),
    ...overrides,
  });

  beforeEach(async () => {
    appointmentModel = {
      find: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockReturnThis(),
      findById: jest.fn().mockReturnThis(),
      findByIdAndUpdate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: getModelToken('Appointment'), useValue: appointmentModel },
        { provide: DoctorsService, useValue: { findById: jest.fn() } },
        { provide: PatientsService, useValue: { findById: jest.fn() } },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
  });

  describe('assign', () => {
    it('rejects if appointment is not in requested status', async () => {
      const apt = mockAppointment({ status: 'assigned' });
      appointmentModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(apt) });

      await expect(service.assign('doc-1', 'apt-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFound when appointment does not exist', async () => {
      appointmentModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.assign('doc-1', 'apt-1')).rejects.toThrow(NotFoundException);
    });

    it('assigns a doctor when status is requested', async () => {
      const apt = mockAppointment();
      appointmentModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(apt) });

      // Mock the follow-up calls
      const module = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          { provide: getModelToken('Appointment'), useValue: appointmentModel },
          { provide: DoctorsService, useValue: { findById: jest.fn().mockResolvedValue({ _id: 'doc-1', title: 'Dr.', firstName: 'Rohan', lastName: 'Mehta', specialty: 'Cardiology' }) } },
          { provide: PatientsService, useValue: { findById: jest.fn().mockResolvedValue({ _id: 'pat-1', user: 'user-1' }) } },
          { provide: NotificationsService, useValue: { create: jest.fn() } },
        ],
      }).compile();
      service = module.get<AppointmentsService>(AppointmentsService);

      const result = await service.assign('doc-1', 'apt-1');
      expect(apt.status).toBe('assigned');
      expect(apt.save).toHaveBeenCalled();
    });
  });
});
