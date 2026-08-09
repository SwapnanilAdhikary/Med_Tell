import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CallSession, CallSessionSchema } from './schemas/call-session.schema';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { AiModule } from '../ai/ai.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { VerificationModule } from '../verification/verification.module';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PatientsModule } from '../patients/patients.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { HealthWorkersModule } from '../health-workers/health-workers.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { FacilitiesModule } from '../facilities/facilities.module';
import { FieldReportsModule } from '../field-reports/field-reports.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CallSession.name, schema: CallSessionSchema },
    ]),
    AiModule,
    AppointmentsModule,
    VerificationModule,
    AuthModule,
    ConversationsModule,
    PatientsModule,
    CertificatesModule,
    HealthWorkersModule,
    DoctorsModule,
    FacilitiesModule,
    // One-way: FieldReports knows nothing about Calls, so no forwardRef.
    FieldReportsModule,
  ],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
