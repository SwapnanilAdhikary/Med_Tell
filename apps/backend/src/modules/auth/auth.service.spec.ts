import * as crypto from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { User } from './schemas/user.schema';
import { PatientsService } from '../patients/patients.service';
import { DoctorsService } from '../doctors/doctors.service';
import { HealthWorkersService } from '../health-workers/health-workers.service';

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

function scrypt(
  password: string,
  salt: string,
  keylen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

async function makeStoredHash(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

describe('AuthService', () => {
  let service: AuthService;

  const userModel = {
    findOne: jest.fn(),
    create: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
  };
  const patientsService = {
    findByUser: jest.fn(),
    getOrCreateByUser: jest.fn(),
    update: jest.fn(),
  };
  const doctorsService = {
    findByUser: jest.fn(),
    create: jest.fn(),
  };
  const healthWorkersService = {
    findByUser: jest.fn(),
    create: jest.fn(),
  };

  function findOneReturns(value: unknown) {
    userModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(value),
    });
  }

  /** One queued result per findOne call, for the create-then-reuse paths. */
  function findOneSequence(...values: unknown[]) {
    userModel.findOne.mockReset();
    for (const value of values) {
      userModel.findOne.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(value),
      });
    }
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    jwtService.signAsync.mockResolvedValue('signed-token');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: JwtService, useValue: jwtService },
        { provide: PatientsService, useValue: patientsService },
        { provide: DoctorsService, useValue: doctorsService },
        { provide: HealthWorkersService, useValue: healthWorkersService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('creates a patient user and profile, returning a session', async () => {
      findOneReturns(null);
      userModel.create.mockResolvedValue({
        _id: 'user-1',
        phone: '+919800000001',
        name: 'Priya',
        role: 'patient',
      });
      patientsService.getOrCreateByUser.mockResolvedValue({ _id: 'patient-1' });
      patientsService.findByUser.mockResolvedValue({ _id: 'patient-1' });

      const session = await service.register({
        phone: '+919800000001',
        password: 'secret123',
        name: 'Priya',
        role: 'patient',
      });

      expect(userModel.create).toHaveBeenCalledWith({
        phone: '+919800000001',
        passwordHash: expect.stringMatching(/^[0-9a-f]{32}:[0-9a-f]{128}$/),
        role: 'patient',
        name: 'Priya',
      });
      expect(patientsService.getOrCreateByUser).toHaveBeenCalledWith(
        'user-1',
        'Priya',
      );
      expect(session).toEqual({
        token: 'signed-token',
        user: expect.objectContaining({
          patientId: 'patient-1',
          role: 'patient',
        }),
      });
    });

    it('creates a doctor profile for doctor registration', async () => {
      findOneReturns(null);
      userModel.create.mockResolvedValue({
        _id: 'user-2',
        phone: '+919800000002',
        name: 'Ananya',
        role: 'doctor',
      });
      doctorsService.create.mockResolvedValue({ _id: 'doctor-1' });

      await service.register({
        phone: '+919800000002',
        password: 'secret123',
        name: 'Ananya',
        role: 'doctor',
        specialty: 'Cardiology',
      });

      expect(doctorsService.create).toHaveBeenCalledWith({
        user: 'user-2',
        name: 'Ananya',
        specialty: 'Cardiology',
        title: undefined,
      });
      expect(patientsService.getOrCreateByUser).not.toHaveBeenCalled();
    });

    it('creates a health worker profile for worker registration', async () => {
      findOneReturns(null);
      userModel.create.mockResolvedValue({
        _id: 'user-3',
        phone: '+919700000001',
        name: 'Anjali Roy',
        role: 'health_worker',
      });
      healthWorkersService.create.mockResolvedValue({ _id: 'worker-1' });
      healthWorkersService.findByUser.mockResolvedValue({ _id: 'worker-1' });

      const session = await service.register({
        phone: '+919700000001',
        password: 'secret123',
        name: 'Anjali Roy',
        role: 'health_worker',
        worker: { cadre: 'ANM', village: 'Beldanga' },
      });

      expect(healthWorkersService.create).toHaveBeenCalledWith({
        user: 'user-3',
        name: 'Anjali Roy',
        cadre: 'ANM',
        village: 'Beldanga',
      });
      expect(patientsService.getOrCreateByUser).not.toHaveBeenCalled();
      expect(doctorsService.create).not.toHaveBeenCalled();
      expect(session.user).toEqual(
        expect.objectContaining({
          workerId: 'worker-1',
          patientId: undefined,
          doctorId: undefined,
        }),
      );
    });

    it('defaults a worker with no worker block to the ASHA cadre', async () => {
      findOneReturns(null);
      userModel.create.mockResolvedValue({
        _id: 'user-3',
        phone: '+919700000001',
        name: 'Anjali Roy',
        role: 'health_worker',
      });

      await service.register({
        phone: '+919700000001',
        password: 'secret123',
        name: 'Anjali Roy',
        role: 'health_worker',
      });

      expect(healthWorkersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ cadre: 'ASHA' }),
      );
    });

    it('rejects a duplicate phone number', async () => {
      findOneReturns({ _id: 'user-1' });

      await expect(
        service.register({
          phone: '+919800000001',
          password: 'secret123',
          name: 'Priya',
        }),
      ).rejects.toThrow(ConflictException);
      expect(userModel.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns a session with the patient id on valid credentials', async () => {
      const storedHash = await makeStoredHash('demo123');
      findOneReturns({
        _id: 'user-1',
        phone: '+919800000001',
        name: 'Priya',
        role: 'patient',
        passwordHash: storedHash,
      });
      patientsService.findByUser.mockResolvedValue({ _id: 'patient-1' });

      const session = await service.login('+919800000001', 'demo123');

      expect(session.token).toBe('signed-token');
      expect(session.user).toEqual(
        expect.objectContaining({ patientId: 'patient-1', role: 'patient' }),
      );
    });

    it('includes the doctor id for doctor accounts', async () => {
      const storedHash = await makeStoredHash('demo123');
      findOneReturns({
        _id: 'user-2',
        phone: '+919800000002',
        name: 'Ananya',
        role: 'doctor',
        passwordHash: storedHash,
      });
      doctorsService.findByUser.mockResolvedValue({ _id: 'doctor-1' });

      const session = await service.login('+919800000002', 'demo123');

      expect(session.user).toEqual(
        expect.objectContaining({ doctorId: 'doctor-1', role: 'doctor' }),
      );
    });

    it('throws for an unknown phone number', async () => {
      findOneReturns(null);

      await expect(service.login('+919800000099', 'demo123')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws for a wrong password', async () => {
      const storedHash = await makeStoredHash('demo123');
      findOneReturns({
        _id: 'user-1',
        phone: '+919800000001',
        role: 'patient',
        passwordHash: storedHash,
      });

      await expect(service.login('+919800000001', 'wrongpass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a malformed stored hash instead of throwing RangeError', async () => {
      findOneReturns({
        _id: 'user-1',
        phone: '+919876543210',
        role: 'patient',
        passwordHash: 'abcd:ef', // wrong length - timingSafeEqual would throw
      });

      await expect(service.login('+919876543210', 'demo123')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('findOrCreatePatientByPhone', () => {
    const shadowUser = {
      _id: 'user-9',
      phone: '+919876543210',
      name: 'Caller 3210',
      role: 'patient',
    };

    it('creates one patient for an unknown number and reuses it on the second call', async () => {
      findOneSequence(null, shadowUser);
      userModel.create.mockResolvedValue(shadowUser);
      patientsService.getOrCreateByUser.mockResolvedValue({
        _id: 'patient-9',
        name: 'Caller 3210',
      });

      const first = await service.findOrCreatePatientByPhone('+919876543210');
      const second = await service.findOrCreatePatientByPhone('+919876543210');

      expect(userModel.create).toHaveBeenCalledTimes(1);
      expect(first).toEqual({
        patientId: 'patient-9',
        userId: 'user-9',
        created: true,
      });
      expect(second).toEqual({
        patientId: 'patient-9',
        userId: 'user-9',
        created: false,
      });
    });

    it('names an anonymous caller after the last four digits', async () => {
      findOneReturns(null);
      userModel.create.mockResolvedValue(shadowUser);
      patientsService.getOrCreateByUser.mockResolvedValue({
        _id: 'patient-9',
        name: 'Caller 3210',
      });

      await service.findOrCreatePatientByPhone('+919876543210');

      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Caller 3210', role: 'patient' }),
      );
    });

    it('gives two shadow users different password hashes', async () => {
      findOneReturns(null);
      userModel.create.mockResolvedValue(shadowUser);
      patientsService.getOrCreateByUser.mockResolvedValue({ _id: 'patient-9' });

      await service.findOrCreatePatientByPhone('+919876543210');
      await service.findOrCreatePatientByPhone('+919876543211');

      const [a, b] = (
        userModel.create.mock.calls as Array<[{ passwordHash: string }]>
      ).map((call) => call[0].passwordHash);
      expect(a).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
      expect(b).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
      expect(a).not.toBe(b);
    });

    it('resolves a user that exists without a patient record', async () => {
      findOneReturns({ ...shadowUser, name: undefined });
      patientsService.getOrCreateByUser.mockResolvedValue({
        _id: 'patient-9',
        name: 'Caller 3210',
      });

      const result = await service.findOrCreatePatientByPhone('+919876543210');

      expect(patientsService.getOrCreateByUser).toHaveBeenCalledWith(
        'user-9',
        'Caller 3210',
        'en',
      );
      expect(result.patientId).toBe('patient-9');
      expect(userModel.create).not.toHaveBeenCalled();
    });

    it('backfills a placeholder name but never overwrites a real one', async () => {
      findOneReturns(shadowUser);
      patientsService.getOrCreateByUser.mockResolvedValue({
        _id: 'patient-9',
        name: 'Caller 3210',
      });

      await service.findOrCreatePatientByPhone('+919876543210', {
        name: 'Sita Devi',
      });
      expect(patientsService.update).toHaveBeenCalledWith('patient-9', {
        name: 'Sita Devi',
      });

      patientsService.update.mockClear();
      patientsService.getOrCreateByUser.mockResolvedValue({
        _id: 'patient-9',
        name: 'Sita Devi',
      });

      await service.findOrCreatePatientByPhone('+919876543210', {
        name: 'Someone Else',
      });
      expect(patientsService.update).not.toHaveBeenCalled();
    });

    it('refuses to attach a phone number that belongs to a doctor', async () => {
      findOneReturns({ _id: 'user-2', phone: '+919800000001', role: 'doctor' });

      await expect(
        service.findOrCreatePatientByPhone('+919800000001'),
      ).rejects.toThrow(ConflictException);
      expect(patientsService.getOrCreateByUser).not.toHaveBeenCalled();
    });

    it('re-reads by phone when a concurrent create wins the unique index', async () => {
      findOneSequence(null, shadowUser);
      userModel.create.mockRejectedValue({ code: 11000 });
      patientsService.getOrCreateByUser.mockResolvedValue({
        _id: 'patient-9',
        name: 'Caller 3210',
      });

      const result = await service.findOrCreatePatientByPhone('+919876543210');

      expect(result).toEqual({
        patientId: 'patient-9',
        userId: 'user-9',
        created: false,
      });
    });
  });
});
