import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CallsService } from './calls.service';

class TranscriptTurnDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string;
}

class CompleteCallDto {
  @IsString()
  @MaxLength(200)
  vapiCallId: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranscriptTurnDto)
  transcript?: TranscriptTurnDto[];

  @IsOptional()
  @IsString()
  @MaxLength(40000)
  transcriptText?: string;

  @IsOptional()
  @IsISO8601()
  startedAt?: string;

  @IsOptional()
  @IsISO8601()
  endedAt?: string;
}

@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get('session')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('patient')
  webSession(
    @CurrentUser() user: AuthUser,
    @Query('language') language?: string,
  ) {
    return this.callsService.getWebSession(user.patientId!, language);
  }

  /**
   * Browser calls never reach Vapi's webhook, so the client posts the transcript
   * here when the call ends. The patient comes from the token, never the body.
   */
  @Post('complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('patient')
  complete(@CurrentUser() user: AuthUser, @Body() body: CompleteCallDto) {
    return this.callsService.completeWebCall(user.patientId!, body);
  }

  @Post('vapi/webhook')
  webhook(@Body() body: Record<string, unknown>) {
    return this.callsService.handleWebhook(body);
  }

  @Get('patient')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('patient')
  listForPatient(@CurrentUser() user: AuthUser) {
    return this.callsService.listForPatient(user.patientId!);
  }

  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('doctor')
  listAll() {
    return this.callsService.listAll();
  }
}
