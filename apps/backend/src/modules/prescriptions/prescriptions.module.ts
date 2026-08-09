import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Prescription,
  PrescriptionSchema,
} from './schemas/prescription.schema';
import { PrescriptionsService } from './prescriptions.service';
import { AiModule } from '../ai/ai.module';
import { VerificationModule } from '../verification/verification.module';
import { PatientsModule } from '../patients/patients.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Prescription.name, schema: PrescriptionSchema },
    ]),
    AiModule,
    forwardRef(() => VerificationModule),
    PatientsModule,
    DoctorsModule,
    NotificationsModule,
  ],
  providers: [PrescriptionsService],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
