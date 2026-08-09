import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { VapiWebhookGuard } from '../../common/guards/vapi-webhook.guard';
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

/**
 * Named lat/lng, and declared explicitly: ValidationPipe({whitelist:true})
 * silently strips an undeclared nested object, which would have left every
 * field call stamped with the worker's assigned-area centroid instead of the
 * point they tapped.
 */
class CallGeoDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracyM?: number;

  @IsOptional()
  @IsBoolean()
  picked?: boolean;
}

class CompleteFieldCallDto extends CompleteCallDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CallGeoDto)
  geo?: CallGeoDto;

  @IsOptional()
  @IsIn(['en', 'hi', 'bn'])
  language?: string;
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

  @Get('session/field')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('health_worker')
  fieldSession(
    @CurrentUser() user: AuthUser,
    @Query('language') language?: string,
  ) {
    return this.callsService.getFieldWebSession(user.workerId, language);
  }

  @Post('complete/field')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('health_worker')
  completeField(
    @CurrentUser() user: AuthUser,
    @Body() body: CompleteFieldCallDto,
  ) {
    return this.callsService.completeFieldWebCall(
      { workerId: user.workerId, phone: user.phone },
      body,
    );
  }

  // Vapi authenticates with a shared secret, not a JWT. The guard no-ops while
  // VAPI_WEB_SECRET is empty, so the tunnel-free dev path is unaffected.
  @Post('vapi/webhook')
  @UseGuards(VapiWebhookGuard)
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
