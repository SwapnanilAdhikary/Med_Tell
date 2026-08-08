import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, UpdateQuery } from 'mongoose';
import { Patient, PatientDocument } from './schemas/patient.schema';
import { idFilter } from '../../common/mongoose.util';

@Injectable()
export class PatientsService {
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
  ) {}

  async findByUser(
    userId: string | Types.ObjectId,
  ): Promise<PatientDocument | null> {
    return this.patientModel.findOne(idFilter('user', userId)).exec();
  }

  async getOrCreateByUser(
    userId: string | Types.ObjectId,
    name: string,
    language = 'en',
  ): Promise<PatientDocument> {
    const existing = await this.findByUser(userId);
    if (existing) return existing;
    return this.patientModel.create({
      user: userId,
      name,
      language,
    });
  }

  async findById(id: string | Types.ObjectId): Promise<PatientDocument> {
    const patient = await this.patientModel.findById(id).exec();
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  async update(
    id: string | Types.ObjectId,
    patch: UpdateQuery<Patient>,
  ): Promise<PatientDocument> {
    const patient = await this.patientModel
      .findByIdAndUpdate(id, patch, { new: true })
      .exec();
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }
}
