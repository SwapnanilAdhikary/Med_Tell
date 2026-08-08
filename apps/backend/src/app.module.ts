import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { FacilitiesModule } from './modules/facilities/facilities.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { ChatModule } from './modules/chat/chat.module';
import { CallsModule } from './modules/calls/calls.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { VerificationModule } from './modules/verification/verification.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    AppConfigModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    AuthModule,
    PatientsModule,
    DoctorsModule,
    FacilitiesModule,
    AppointmentsModule,
    ConversationsModule,
    ChatModule,
    CallsModule,
    DocumentsModule,
    CertificatesModule,
    VerificationModule,
    NotificationsModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
