import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  VerificationTask,
  VerificationTaskSchema,
} from './schemas/verification-task.schema';
import { VerificationService } from './verification.service';
import { VerificationController } from './verification.controller';
import { DocumentsModule } from '../documents/documents.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { PatientsModule } from '../patients/patients.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VerificationTask.name, schema: VerificationTaskSchema },
    ]),
    forwardRef(() => DocumentsModule),
    forwardRef(() => CertificatesModule),
    PatientsModule,
    NotificationsModule,
  ],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
