import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
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
import { Roles } from '../../common/decorators/roles.decorator';
import { FieldReportsService } from './field-reports.service';

/**
 * Named lat/lng, never a bare tuple: this is the real defence against a
 * coordinate swap. FacilitiesService.isLngLat is only the backstop.
 *
 * `source` is deliberately absent - the service is the sole writer of
 * location.source, or the honesty field would be client-controlled.
 */
class GeoDto {
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
}

/** Real ranges, so a fat-fingered entry 400s instead of reaching a doctor. */
class VitalsDto {
  @IsOptional() @IsNumber() @Min(30) @Max(45) temperatureC?: number;
  @IsOptional() @IsNumber() @Min(50) @Max(100) spo2?: number;
  @IsOptional() @IsNumber() @Min(50) @Max(300) systolic?: number;
  @IsOptional() @IsNumber() @Min(20) @Max(200) diastolic?: number;
  @IsOptional() @IsNumber() @Min(20) @Max(250) pulse?: number;
  @IsOptional() @IsNumber() @Min(5) @Max(80) respRate?: number;
  @IsOptional() @IsNumber() @Min(0.5) @Max(300) weightKg?: number;
  @IsOptional() @IsNumber() @Min(10) @Max(900) glucoseMgDl?: number;
}

class SubjectDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(20)
  phone!: string;

  @IsOptional() @IsNumber() @Min(0) @Max(120) ageYears?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1440) ageMonths?: number;

  @IsOptional()
  @IsIn(['female', 'male', 'other'])
  gender?: string;

  @IsOptional() @IsBoolean() pregnant?: boolean;
  @IsOptional() @IsNumber() @Min(1) @Max(10) pregnancyMonths?: number;
}

class CreateFieldReportDto {
  // Without @ValidateNested + @Type the whitelist silently strips these.
  @ValidateNested()
  @Type(() => SubjectDto)
  subject!: SubjectDto;

  @IsOptional()
  @IsIn(['en', 'hi', 'bn'])
  language?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  symptoms?: string[];

  @IsOptional() @IsString() @MaxLength(120) duration?: string;

  @IsOptional()
  @IsIn(['improving', 'stable', 'worsening'])
  trend?: string;

  @IsOptional()
  @IsIn(['routine', 'semi-urgent', 'urgent', 'emergency'])
  urgency?: 'routine' | 'semi-urgent' | 'urgent' | 'emergency';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  dangerSigns?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => VitalsDto)
  vitals?: VitalsDto;

  @IsOptional() @IsString() @MaxLength(8000) narrative?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoDto)
  geo?: GeoDto;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('field-reports')
export class FieldReportsController {
  constructor(private readonly fieldReportsService: FieldReportsService) {}

  @Post()
  @Roles('health_worker')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateFieldReportDto) {
    return this.fieldReportsService.submit(user.workerId, body);
  }

  @Get('mine')
  @Roles('health_worker')
  mine(@CurrentUser() user: AuthUser) {
    return this.fieldReportsService.listForWorker(user.workerId);
  }

  @Get(':id')
  @Roles('health_worker')
  one(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.fieldReportsService.findForWorker(user.workerId, id);
  }
}
