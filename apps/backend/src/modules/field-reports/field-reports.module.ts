import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { FieldReport, FieldReportSchema } from './schemas/field-report.schema';
import { FieldReportsService } from './field-reports.service';
import { FieldReportsController } from './field-reports.controller';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { HealthWorkersModule } from '../health-workers/health-workers.module';
import { FacilitiesModule } from '../facilities/facilities.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { FieldNotesModule } from '../field-notes/field-notes.module';

// Voice notes are transcribed then deleted, so they live in a scratch dir and
// are never served - unlike uploads/, which ServeStatic exposes.
const AUDIO_DIR = path.join(process.cwd(), 'tmp-audio');

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FieldReport.name, schema: FieldReportSchema },
    ]),
    MulterModule.register({
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!fs.existsSync(AUDIO_DIR))
            fs.mkdirSync(AUDIO_DIR, { recursive: true });
          cb(null, AUDIO_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname) || '.webm';
          cb(null, `${Date.now()}-${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
    AiModule,
    AuthModule,
    HealthWorkersModule,
    FacilitiesModule,
    AppointmentsModule,
    // A leaf module (own model only), so this stays a one-way edge.
    FieldNotesModule,
  ],
  controllers: [FieldReportsController],
  providers: [FieldReportsService],
  exports: [FieldReportsService],
})
export class FieldReportsModule {}
