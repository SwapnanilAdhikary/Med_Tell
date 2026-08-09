import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AppointmentsService } from './appointments.service';
import { Appointment } from './schemas/appointment.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PatientsService } from '../patients/patients.service';
import { DoctorsService } from '../doctors/doctors.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

const PATIENT = {
  _id: 'patient-1',
  user: 'user-1',
  name: 'Rahul Verma',
  gender: 'male',
  language: 'hi',
  healthProfile: { allergies: ['penicillin'], conditions: [], medications: [] },
};

const DOCTOR = {
  _id: 'doctor-1',
  user: 'user-2',
  name: 'Rohan Mehta',
  title: 'MBBS, DM',
  specialty: 'Cardiology',
};

describe('AppointmentsService.book', () => {
  let service: AppointmentsService;

  const appointmentModel = { create: jest.fn() };
  const notificationsService = { create: jest.fn() };
  const patientsService = { findById: jest.fn() };
  const doctorsService = { findBestMatch: jest.fn() };

  /** The notification sent to the doctor's user, or undefined if there was none. */
  const doctorNote = () =>
    notificationsService.create.mock.calls
      .map((c) => c[0])
      .find((n) => n.user === DOCTOR.user);

  const patientNote = () =>
    notificationsService.create.mock.calls
      .map((c) => c[0])
      .find((n) => n.user === PATIENT.user);

  const createdWith = () => appointmentModel.create.mock.calls[0][0];

  beforeEach(async () => {
    jest.clearAllMocks();
    patientsService.findById.mockResolvedValue({ ...PATIENT });
    doctorsService.findBestMatch.mockResolvedValue({ ...DOCTOR });
    appointmentModel.create.mockResolvedValue({ _id: 'appt-1' });
    notificationsService.create.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        {
          provide: getModelToken(Appointment.name),
          useValue: appointmentModel,
        },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: PatientsService, useValue: patientsService },
        { provide: DoctorsService, useValue: doctorsService },
      ],
    }).compile();

    service = module.get(AppointmentsService);
  });

  describe('the pre-existing path', () => {
    it('still defaults the type to call-back', async () => {
      await service.book({ patientId: 'patient-1', reason: 'chest pain' });
      expect(createdWith().type).toBe('call-back');
    });

    it('produces a byte-identical doctor brief when reportedBy is absent', async () => {
      await service.book({
        patientId: 'patient-1',
        reason: 'chest pain',
        urgency: 'urgent',
        symptoms: ['chest pain', 'sweating'],
        preferredWindow: 'As soon as possible',
        bestContactNumber: '+919876543211',
      });

      expect(doctorNote().body).toBe(
        [
          'Patient: Rahul Verma (male)',
          'Urgency: urgent',
          'Reason: chest pain',
          'Symptoms: chest pain, sweating',
          'Allergies: penicillin',
          'Preferred window: As soon as possible',
          'Contact: +919876543211',
        ].join('\n'),
      );
    });

    it('still tells the patient a doctor will call back', async () => {
      await service.book({
        patientId: 'patient-1',
        preferredWindow: 'This evening',
      });
      expect(patientNote().body).toBe(
        'You have been matched with Dr. Rohan Mehta (Cardiology). They will confirm and call you back (This evening).',
      );
    });

    it('creates the appointment and notifies the patient when nobody matched', async () => {
      doctorsService.findBestMatch.mockResolvedValue(null);

      const { appointment, doctor } = await service.book({
        patientId: 'patient-1',
      });

      expect(appointment._id).toBe('appt-1');
      expect(doctor).toBeNull();
      expect(createdWith().suggestedDoctor).toBeUndefined();
      expect(doctorNote()).toBeUndefined();
      expect(patientNote().body).toBe('A doctor will call you back.');
    });

    it('passes undefined as the facility when there is none', async () => {
      await service.book({ patientId: 'patient-1', specialty: 'Cardiology' });
      expect(doctorsService.findBestMatch).toHaveBeenCalledWith(
        'Cardiology',
        'hi',
        { facility: undefined },
      );
    });
  });

  describe('a field report', () => {
    const fieldInput = {
      patientId: 'patient-1',
      reason: 'Fever for three days in a 2-year-old.',
      urgency: 'urgent',
      symptoms: ['fever', 'cough'],
      vitals: ['temp 39.2 °C', 'SpO2 94%'],
      facility: 'facility-1',
      type: 'in-person' as const,
      reportedBy: {
        workerName: 'Anjali Roy',
        cadre: 'ASHA',
        village: 'Beldanga',
        facilityName: 'PHC Beldanga',
      },
    };

    it('forwards the facility to findBestMatch as the third argument', async () => {
      await service.book({ ...fieldInput, specialty: 'Pediatrics' });
      expect(doctorsService.findBestMatch).toHaveBeenCalledWith(
        'Pediatrics',
        'hi',
        { facility: 'facility-1' },
      );
    });

    it('writes the in-person type through', async () => {
      await service.book(fieldInput);
      expect(createdWith().type).toBe('in-person');
    });

    it('names the worker, village and facility around the patient line', async () => {
      await service.book(fieldInput);
      expect(doctorNote().body).toBe(
        [
          'Reported by Anjali Roy (ASHA)',
          'Patient: Rahul Verma (male)',
          'Village: Beldanga',
          'Nearest facility: PHC Beldanga',
          'Urgency: urgent',
          'Reason: Fever for three days in a 2-year-old.',
          'Symptoms: fever, cough',
          'Vitals: temp 39.2 °C, SpO2 94%',
          'Allergies: penicillin',
        ].join('\n'),
      );
    });

    it('tells the patient to visit, not to expect a call', async () => {
      await service.book(fieldInput);
      expect(patientNote().body).toBe(
        'Please visit PHC Beldanga as soon as you can. Show this message when you arrive.',
      );
    });

    it('does not name the matched doctor at the nearest facility', async () => {
      // Proximity is worth 15 points, so the best match often works elsewhere.
      await service.book(fieldInput);
      expect(patientNote().body).not.toContain('Rohan Mehta');
    });

    it('drops empty vitals from the brief', async () => {
      await service.book({ ...fieldInput, vitals: [] });
      expect(doctorNote().body).not.toContain('Vitals');
    });
  });
});

describe('AppointmentsService.assign', () => {
  let service: AppointmentsService;
  let module: TestingModule;
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
      findOneAndUpdate: jest.fn().mockReturnThis(),
      exists: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    module = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: getModelToken(Appointment.name), useValue: appointmentModel },
        { provide: DoctorsService, useValue: { findById: jest.fn() } },
        { provide: PatientsService, useValue: { findById: jest.fn() } },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
  });

  describe('assign', () => {
    it('throws BadRequest when the appointment is not in requested status', async () => {
      appointmentModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      appointmentModel.exists.mockResolvedValue({ _id: 'apt-1' });

      await expect(service.assign('doc-1', 'apt-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFound when the appointment does not exist', async () => {
      appointmentModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      appointmentModel.exists.mockResolvedValue(null);

      await expect(service.assign('doc-1', 'apt-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('atomically assigns a doctor when the status is requested', async () => {
      const apt = mockAppointment({ status: 'assigned' });
      appointmentModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(apt),
      });

      const doctorsService = module.get<DoctorsService>(DoctorsService);
      const patientsService = module.get<PatientsService>(PatientsService);
      (doctorsService.findById as jest.Mock).mockResolvedValue({
        _id: 'doc-1',
        name: 'Rohan Mehta',
        specialty: 'Cardiology',
      });
      (patientsService.findById as jest.Mock).mockResolvedValue({
        _id: 'pat-1',
        user: 'user-1',
      });

      const result = await service.assign('doc-1', 'apt-1');

      expect(appointmentModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'apt-1', status: 'requested' },
        { doctor: 'doc-1', status: 'assigned' },
        { new: true },
      );
      expect(apt.populate).toHaveBeenCalledWith('patient');
      expect(result).toBe(apt);
    });
  });
});
