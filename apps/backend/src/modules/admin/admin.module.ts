import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/schemas/appointment.schema';
import {
  MedicalDocument,
  MedicalDocumentSchema,
} from '../documents/schemas/medical-document.schema';
import {
  Certificate,
  CertificateSchema,
} from '../certificates/schemas/certificate.schema';
import {
  CallSession,
  CallSessionSchema,
} from '../calls/schemas/call-session.schema';
import {
  VerificationTask,
  VerificationTaskSchema,
} from '../verification/schemas/verification-task.schema';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';
import { Doctor, DoctorSchema } from '../doctors/schemas/doctor.schema';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: MedicalDocument.name, schema: MedicalDocumentSchema },
      { name: Certificate.name, schema: CertificateSchema },
      { name: CallSession.name, schema: CallSessionSchema },
      { name: VerificationTask.name, schema: VerificationTaskSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Doctor.name, schema: DoctorSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
