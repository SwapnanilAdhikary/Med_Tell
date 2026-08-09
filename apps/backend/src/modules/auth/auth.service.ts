import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'node:crypto';
import { User, UserDocument } from './schemas/user.schema';
import { PatientsService } from '../patients/patients.service';
import { DoctorsService } from '../doctors/doctors.service';
import { HealthWorkersService } from '../health-workers/health-workers.service';
import type { Cadre } from '../health-workers/schemas/health-worker.schema';

export interface RegisterWorkerDto {
  cadre?: Cadre;
  workerCode?: string;
  village?: string;
  block?: string;
  district?: string;
  state?: string;
  languages?: string[];
}

export interface RegisterDto {
  phone: string;
  password: string;
  name: string;
  role?: 'patient' | 'doctor' | 'health_worker';
  specialty?: string;
  title?: string;
  worker?: RegisterWorkerDto;
}

const SCRYPT_KEYLEN = 64;

/** Placeholder for a villager we only know by the number that called in. */
function placeholderName(phone: string): string {
  return `Caller ${phone.slice(-4)}`;
}

function isPlaceholderName(name?: string): boolean {
  return /^Caller \d+$/.test(name ?? '');
}

/**
 * Indian mobile numbers to one canonical form, so the same person entered as
 * `9876543211`, `09876543211`, `919876543211` or `+91 98765 43211` resolves to
 * ONE patient. Without this, a worker typing a number differently from the way
 * the patient registered silently created a second record, and a doctor's chat
 * went to the copy nobody can log into.
 *
 * Anything that is not a recognisable 10-digit Indian mobile is left alone -
 * synthetic `local:` keys and foreign numbers must pass through untouched.
 */
export function canonicalPhone(phone: string): string {
  if (!phone || phone.startsWith('local:')) return phone;
  const digits = phone.replace(/\D/g, '');
  const national =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits.length === 12 && digits.startsWith('91')
          ? digits.slice(2)
          : digits.length === 13 && digits.startsWith('091')
            ? digits.slice(3)
            : '';
  // Indian mobiles start 6-9. Anything else is not a number we can normalise.
  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : phone;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwtService: JwtService,
    private readonly patientsService: PatientsService,
    private readonly doctorsService: DoctorsService,
    private readonly healthWorkersService: HealthWorkersService,
  ) {}

  async register(dto: RegisterDto) {
    const role = dto.role ?? 'patient';
    const exists = await this.userModel.findOne({ phone: dto.phone }).exec();
    if (exists) throw new ConflictException('Phone number already registered');

    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.userModel.create({
      phone: dto.phone,
      passwordHash,
      role,
      name: dto.name,
    });

    if (role === 'doctor') {
      await this.doctorsService.create({
        user: user._id,
        name: dto.name,
        specialty: dto.specialty ?? 'General Medicine',
        title: dto.title,
      });
    } else if (role === 'health_worker') {
      await this.healthWorkersService.create({
        ...dto.worker,
        user: user._id,
        name: dto.name,
        // ponytail: ASHA is the far larger cadre, so it is the default rather
        // than a conditional @ValidateIf on the register body.
        cadre: dto.worker?.cadre ?? 'ASHA',
      });
    } else {
      await this.patientsService.getOrCreateByUser(
        user._id.toString(),
        dto.name,
      );
    }

    return this.buildSession(user);
  }

  async login(phone: string, password: string) {
    const user = await this.userModel.findOne({ phone }).exec();
    if (!user) throw new UnauthorizedException('Invalid phone or password');
    const ok = await this.verifyPassword(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid phone or password');
    return this.buildSession(user);
  }

  async findByPhone(phone: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phone }).exec();
  }

  async findUserById(userId: string): Promise<UserDocument | null> {
    return this.userModel.findById(userId).exec();
  }

  async patientIdForUser(userId: string): Promise<string | null> {
    const patient = await this.patientsService.findByUser(userId);
    return patient ? patient._id.toString() : null;
  }

  /**
   * Resolves a phone number to a patient, creating a "shadow" account for a
   * villager who has never used the app - the person an ASHA worker reports on,
   * or an unknown number that phones the voice agent. Deliberately *not*
   * `register()`: that must reject a known phone with 409, this must reuse it.
   *
   * ponytail: random password, no reset flow - this account can never log into
   * the web app. OTP login is the upgrade path.
   */
  async findOrCreatePatientByPhone(
    rawPhone: string,
    profile?: { name?: string; language?: string },
  ): Promise<{ patientId: string; userId: string; created: boolean }> {
    const phone = canonicalPhone(rawPhone);
    // Both forms: existing rows were written before normalisation, so looking
    // up only the canonical one would create a duplicate of every one of them.
    const existing = await this.userModel
      .findOne(
        phone === rawPhone ? { phone } : { phone: { $in: [phone, rawPhone] } },
      )
      .exec();
    if (existing) return this.patientForUser(existing, profile);

    const name = profile?.name ?? placeholderName(phone);
    try {
      const user = await this.userModel.create({
        phone,
        // A real hash, not a sentinel: verifyPassword compares buffers and a
        // malformed one would turn a login attempt into a 500.
        passwordHash: await this.hashPassword(
          crypto.randomBytes(24).toString('hex'),
        ),
        role: 'patient',
        name,
      });
      const patient = await this.patientsService.getOrCreateByUser(
        user._id.toString(),
        name,
        profile?.language ?? 'en',
      );
      return {
        patientId: patient._id.toString(),
        userId: user._id.toString(),
        created: true,
      };
    } catch (err) {
      // A resent Vapi webhook races with itself; the unique index is the winner.
      if ((err as { code?: number }).code !== 11000) throw err;
      const raced = await this.userModel
        .findOne(
          phone === rawPhone
            ? { phone }
            : { phone: { $in: [phone, rawPhone] } },
        )
        .exec();
      if (!raced) throw err;
      return this.patientForUser(raced, profile);
    }
  }

  private async patientForUser(
    user: UserDocument,
    profile?: { name?: string; language?: string },
  ) {
    if (user.role !== 'patient') {
      throw new ConflictException(
        `Phone number belongs to a ${user.role} account`,
      );
    }
    // getOrCreateByUser, not patientIdForUser: a User can exist without a
    // Patient after a half-failed register.
    const patient = await this.patientsService.getOrCreateByUser(
      user._id.toString(),
      profile?.name ?? user.name ?? placeholderName(user.phone),
      profile?.language ?? 'en',
    );
    if (profile?.name && isPlaceholderName(patient.name)) {
      await this.patientsService.update(patient._id, { name: profile.name });
    }
    return {
      patientId: patient._id.toString(),
      userId: user._id.toString(),
      created: false,
    };
  }

  private async buildSession(user: UserDocument) {
    let patientId: string | undefined;
    let doctorId: string | undefined;
    let workerId: string | undefined;
    if (user.role === 'patient') {
      const patient = await this.patientsService.findByUser(
        user._id.toString(),
      );
      patientId = patient?._id.toString();
    } else if (user.role === 'doctor') {
      const doctor = await this.doctorsService.findByUser(user._id.toString());
      doctorId = doctor?._id.toString();
    } else if (user.role === 'health_worker') {
      const worker = await this.healthWorkersService.findByUser(
        user._id.toString(),
      );
      workerId = worker?._id.toString();
    }

    const payload = {
      sub: user._id.toString(),
      role: user.role,
      phone: user.phone,
      patientId,
      doctorId,
      workerId,
    };
    const token = await this.jwtService.signAsync(payload);
    return {
      token,
      user: {
        id: user._id.toString(),
        phone: user.phone,
        name: user.name,
        role: user.role,
        patientId,
        doctorId,
        workerId,
      },
    };
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await this.scrypt(password, salt, SCRYPT_KEYLEN)).toString(
      'hex',
    );
    return `${salt}:${hash}`;
  }

  private async verifyPassword(
    password: string,
    stored: string,
  ): Promise<boolean> {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const candidate = (
      await this.scrypt(password, salt, SCRYPT_KEYLEN)
    ).toString('hex');
    const a = Buffer.from(candidate, 'hex');
    const b = Buffer.from(hash, 'hex');
    // timingSafeEqual throws RangeError on a length mismatch, which would turn a
    // malformed stored hash into a 500 instead of a 401.
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  private scrypt(
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
}
