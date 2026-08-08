import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AppointmentsService } from './appointments.service';

class AssignBody {
  @IsString()
  appointmentId: string;
}

class CompleteBody {
  @IsString()
  appointmentId: string;

  @IsOptional()
  @IsString()
  consultNotes?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  @Roles('patient')
  listForPatient(@CurrentUser() user: AuthUser) {
    return this.appointmentsService.listForPatient(user.patientId!);
  }

  @Get('queue')
  @Roles('doctor')
  callBackQueue() {
    return this.appointmentsService.listCallBackQueue();
  }

  @Get('doctor')
  @Roles('doctor')
  listForDoctor(@CurrentUser() user: AuthUser) {
    return this.appointmentsService.listForDoctor(user.doctorId!);
  }

  @Post('assign')
  @Roles('doctor')
  assign(@CurrentUser() user: AuthUser, @Body() body: AssignBody) {
    return this.appointmentsService.assign(user.doctorId!, body.appointmentId);
  }

  @Post('complete')
  @Roles('doctor')
  complete(@CurrentUser() user: AuthUser, @Body() body: CompleteBody) {
    return this.appointmentsService.complete(
      user.doctorId!,
      body.appointmentId,
      body.consultNotes ?? '',
    );
  }
}
