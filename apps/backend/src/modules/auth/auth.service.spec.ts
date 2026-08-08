import * as crypto from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { User } from './schemas/user.schema';
import { PatientsService } from '../patients/patients.service';
import { DoctorsService } from '../doctors/doctors.service';

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
  };
  const doctorsService = {
    findByUser: jest.fn(),
    create: jest.fn(),
  };

  function findOneReturns(value: unknown) {
    userModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(value),
    });
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
  });
});
