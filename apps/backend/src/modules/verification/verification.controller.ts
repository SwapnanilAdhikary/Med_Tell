import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
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
import { VerificationService } from './verification.service';

class DecisionBody {
  @IsOptional()
  @IsString()
  comment?: string;
}

class EditItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  dose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  frequency?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  instructions?: string;

  // Carried through so an item the doctor left alone keeps its provenance.
  @IsOptional()
  @IsIn(['O', 'A', 'B', 'prohibited', 'unclassified'])
  tpgList?: string;
}

/**
 * A separate required body on a separate route, not an optional field on
 * DecisionBody: ValidationPipe({whitelist:true}) silently strips unknown keys,
 * so a mis-shaped edit posted to /approve would vanish with no error and the
 * doctor would believe they had edited.
 */
class EditedDecisionBody extends DecisionBody {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EditItemDto)
  items!: EditItemDto[];
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Get('queue')
  @Roles('doctor')
  queue() {
    return this.verificationService.listPending();
  }

  @Get('reviewed')
  @Roles('doctor')
  reviewed(@CurrentUser() user: AuthUser) {
    return this.verificationService.listReviewed(user.doctorId!);
  }

  @Get('summary')
  @Roles('doctor')
  summary() {
    return this.verificationService.summary();
  }

  @Post(':id/approve')
  @Roles('doctor')
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: DecisionBody,
  ) {
    return this.verificationService.approve(id, user.doctorId!, body.comment);
  }

  @Post(':id/approve-edited')
  @Roles('doctor')
  approveEdited(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: EditedDecisionBody,
  ) {
    return this.verificationService.approveWithEdit(
      id,
      user.doctorId!,
      { items: body.items },
      body.comment,
    );
  }

  @Post(':id/reject')
  @Roles('doctor')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: DecisionBody,
  ) {
    return this.verificationService.reject(id, user.doctorId!, body.comment);
  }
}
