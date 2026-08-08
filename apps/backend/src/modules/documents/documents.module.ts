import { BadRequestException, Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';


import {
  MedicalDocument,
  MedicalDocumentSchema,
} from './schemas/medical-document.schema';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { AiModule } from '../ai/ai.module';
import { VerificationModule } from '../verification/verification.module';
import { PatientsModule } from '../patients/patients.module';
import { NotificationsModule } from '../notifications/notifications.module';



@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MedicalDocument.name, schema: MedicalDocumentSchema },
    ]),
    MulterModule.registerAsync({
      useFactory: () => ({
        // Never touches disk — the buffer lives in memory for one request.
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
          // ponytail: rejecting HEIC outright — converting needs a native dep.
          // Revisit if iPhone uploads become common.
          cb(
            new BadRequestException(
              'Please upload a JPG, PNG, WEBP or PDF of the report.',
            ),
            false,
          );
        },
        // base64 inflates by ~33%, and the whole image sits in memory.
        limits: { fileSize: 5 * 1024 * 1024 },
      }),
    }),
    AiModule,
    forwardRef(() => VerificationModule),
    PatientsModule,
    NotificationsModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
