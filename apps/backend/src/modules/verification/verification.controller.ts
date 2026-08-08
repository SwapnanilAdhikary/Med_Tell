import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
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
