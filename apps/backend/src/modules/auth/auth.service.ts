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

export interface RegisterDto {
  phone: string;
  password: string;
  name: string;
  role?: 'patient' | 'doctor';
  specialty?: string;
  title?: string;
}

const SCRYPT_KEYLEN = 64;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwtService: JwtService,
    private readonly patientsService: PatientsService,
    private readonly doctorsService: DoctorsService,
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

  async patientIdForUser(userId: string): Promise<string | null> {
    const patient = await this.patientsService.findByUser(userId);
    return patient ? patient._id.toString() : null;
  }

  private async buildSession(user: UserDocument) {
    let patientId: string | undefined;
    let doctorId: string | undefined;
    if (user.role === 'patient') {
      const patient = await this.patientsService.findByUser(
        user._id.toString(),
      );
      patientId = patient?._id.toString();
    } else if (user.role === 'doctor') {
      const doctor = await this.doctorsService.findByUser(user._id.toString());
      doctorId = doctor?._id.toString();
    }

    const payload = {
      sub: user._id.toString(),
      role: user.role,
      phone: user.phone,
      patientId,
      doctorId,
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
    return crypto.timingSafeEqual(
      Buffer.from(candidate, 'hex'),
      Buffer.from(hash, 'hex'),
    );
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
