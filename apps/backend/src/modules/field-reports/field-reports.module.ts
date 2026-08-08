import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FieldReport, FieldReportSchema } from './schemas/field-report.schema';
import { FieldReportsService } from './field-reports.service';
import { FieldReportsController } from './field-reports.controller';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { HealthWorkersModule } from '../health-workers/health-workers.module';
import { FacilitiesModule } from '../facilities/facilities.module';
import { AppointmentsModule } from '../appointments/appointments.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FieldReport.name, schema: FieldReportSchema },
    ]),
    AiModule,
    AuthModule,
    HealthWorkersModule,
    FacilitiesModule,
    AppointmentsModule,
  ],
  controllers: [FieldReportsController],
  providers: [FieldReportsService],
  exports: [FieldReportsService],
})
export class FieldReportsModule {}
