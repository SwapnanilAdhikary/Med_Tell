import { BadRequestException, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { AiModule } from '../ai/ai.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PatientsModule } from '../patients/patients.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { DocumentsModule } from '../documents/documents.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    // Same rules as DocumentsModule — chat uploads must not be a way around
    // the file filter or the size limit.
    MulterModule.registerAsync({
      useFactory: () => ({
        storage: memoryStorage(),
        fileFilter: (
          _req: unknown,
          file: { mimetype: string },
          cb: (error: Error | null, acceptFile: boolean) => void,
        ) => {
          const allowed = [
            'image/png',
            'image/jpeg',
            'image/webp',
            'application/pdf',
          ];
          if (allowed.includes(file.mimetype)) return cb(null, true);
          cb(
            new BadRequestException(
              'Please upload a JPG, PNG, WEBP or PDF of the report.',
            ),
            false,
          );
        },
        limits: { fileSize: 5 * 1024 * 1024 },
      }),
    }),
    AiModule,
    ConversationsModule,
    PatientsModule,
    AppointmentsModule,
    CertificatesModule,
    DocumentsModule,
    DoctorsModule,
    NotificationsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
