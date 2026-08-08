import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Doctor, DoctorDocument } from './schemas/doctor.schema';
import { idFilter } from '../../common/mongoose.util';

/**
 * Reduces a specialty to a comparable stem so the AI's wording still matches the
 * roster: "Cardiologist" / "Cardiology" -> "cardio", "Paediatrics" /
 * "Pediatrics" -> "pediat". Six letters is enough to separate real specialties.
 */
function stem(value: string): string {
  return value
    .toLowerCase()
    .replace(/ae/g, 'e') // British spellings: paediatrics, orthopaedics
    .replace(/[^a-z]/g, '')
    .slice(0, 6);
}

@Injectable()
export class DoctorsService {
  constructor(
    @InjectModel(Doctor.name) private readonly doctorModel: Model<Doctor>,
  ) {}

  async findByUser(
    userId: string | Types.ObjectId,
  ): Promise<DoctorDocument | null> {
    return this.doctorModel.findOne(idFilter('user', userId)).exec();
  }

  async findById(id: string | Types.ObjectId): Promise<DoctorDocument> {
    const doctor = await this.doctorModel.findById(id).exec();
    if (!doctor) throw new NotFoundException('Doctor not found');
    return doctor;
  }

  async list(filter: Record<string, unknown> = {}): Promise<DoctorDocument[]> {
    return this.doctorModel.find(filter).sort({ name: 1 }).exec();
  }

  /**
   * Picks the verified doctor best suited to a specialty (as named by the AI
   * triage summary) and, secondarily, one who speaks the patient's language.
   * Falls back to General Medicine, then to any verified doctor.
   *
   * ponytail: no load balancing - add a fewest-open-appointments tie-break when
   * the roster outgrows a handful of doctors.
   */
  async findBestMatch(
    specialty?: string,
    language?: string,
  ): Promise<DoctorDocument | null> {
    const roster = await this.doctorModel
      .find({ verified: true })
      .sort({ name: 1 })
      .exec();
    if (roster.length === 0) return null;

    const wanted = stem(specialty ?? '');

    const score = (doctor: DoctorDocument): number => {
      const own = stem(doctor.specialty ?? '');
      let points = 0;
      if (wanted && own && (own.includes(wanted) || wanted.includes(own))) {
        points += 100;
      } else if (own.startsWith('genera')) {
        points += 20; // General Medicine takes anything unmatched.
      }
      if (language && (doctor.languages ?? []).includes(language)) points += 10;
      return points;
    };

    // Roster is already name-sorted, so a stable max-by keeps ties deterministic.
    return roster.reduce((best, doctor) =>
      score(doctor) > score(best) ? doctor : best,
    );
  }

  async create(data: Partial<Doctor>): Promise<DoctorDocument> {
    return this.doctorModel.create(data);
  }
}
