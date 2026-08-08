import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Certificate, CertificateSchema } from './schemas/certificate.schema';
import { CertificatesService } from './certificates.service';
import { CertificatesController } from './certificates.controller';
import { AiModule } from '../ai/ai.module';
import { VerificationModule } from '../verification/verification.module';
import { PatientsModule } from '../patients/patients.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Certificate.name, schema: CertificateSchema },
    ]),
    AiModule,
    forwardRef(() => VerificationModule),
    PatientsModule,
    DoctorsModule,
    NotificationsModule,
  ],
  controllers: [CertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
