import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
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
import { PatientsService } from './patients.service';

class HealthProfileDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  allergies?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  conditions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  medications?: string[];
}

/**
 * Explicit allowlist. A `Partial<Patient>` body erases to `Object` at runtime,
 * so ValidationPipe skips it entirely and `user`/`consentGranted` become
 * writable.
 */
class UpdatePatientDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  bloodGroup?: string;

  @IsOptional()
  @IsIn(['en', 'hi', 'bn'])
  language?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => HealthProfileDto)
  healthProfile?: HealthProfileDto;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get('me')
  @Roles('patient')
  async me(@CurrentUser() user: AuthUser) {
    return this.patientsService.findById(user.patientId!);
  }

  @Patch('me')
  @Roles('patient')
  async updateMe(
    @CurrentUser() user: AuthUser,
    @Body() patch: UpdatePatientDto,
  ) {
    return this.patientsService.update(user.patientId!, patch);
  }
}
