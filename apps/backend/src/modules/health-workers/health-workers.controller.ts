import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { HealthWorkersService } from './health-workers.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('health-workers')
export class HealthWorkersController {
  constructor(private readonly healthWorkersService: HealthWorkersService) {}

  /** Read-only: cadre and assigned area are provisioned, not self-edited. */
  @Get('me')
  @Roles('health_worker')
  me(@CurrentUser() user: AuthUser) {
    if (!user.workerId) {
      throw new ForbiddenException('No health worker linked to this account');
    }
    return this.healthWorkersService.findById(user.workerId);
  }
}
