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
import { PrescriptionsModule } from '../prescriptions/prescriptions.module';
import { PatientsModule } from '../patients/patients.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VerificationTask.name, schema: VerificationTaskSchema },
    ]),
    forwardRef(() => DocumentsModule),
    forwardRef(() => CertificatesModule),
    forwardRef(() => PrescriptionsModule),
    PatientsModule,
    NotificationsModule,
    // A leaf module - no forwardRef needed.
    ConversationsModule,
  ],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
