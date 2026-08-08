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
  ],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
