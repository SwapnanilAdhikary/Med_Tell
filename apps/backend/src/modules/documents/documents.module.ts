import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
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

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MedicalDocument.name, schema: MedicalDocumentSchema },
    ]),
    MulterModule.registerAsync({
      useFactory: () => ({
        storage: diskStorage({
          destination: (_req, _file, cb) => {
            if (!fs.existsSync(UPLOAD_DIR))
              fs.mkdirSync(UPLOAD_DIR, { recursive: true });
            cb(null, UPLOAD_DIR);
          },
          filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname);
            cb(null, `${Date.now()}-${randomUUID()}${ext}`);
          },
        }),
        limits: { fileSize: 10 * 1024 * 1024 },
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
