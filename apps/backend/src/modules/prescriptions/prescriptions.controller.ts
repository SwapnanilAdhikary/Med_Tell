import {
  Controller,
  Get,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrescriptionsService } from './prescriptions.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly prescriptionsService: PrescriptionsService) {}

  /** Signed by me, newest first - the doctor's record of what they put a name to. */
  @Get('signed')
  @Roles('doctor')
  signed(@CurrentUser() user: AuthUser) {
    return this.prescriptionsService.listSignedBy(user.doctorId!);
  }

  @Get(':id/pdf')
  @Roles('patient', 'doctor')
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    // Patients only download their own; doctors review any. A health worker
    // uses GET /api/field-reports/:id/prescription/pdf instead, where the
    // ownership rule is "you filed the report".
    const filePath = await this.prescriptionsService.pdfPath(
      id,
      user.role === 'patient' ? user.patientId! : undefined,
    );
    return new StreamableFile(createReadStream(filePath), {
      type: 'application/pdf',
      disposition: `inline; filename="prescription-${id}.pdf"`,
    });
  }
}
