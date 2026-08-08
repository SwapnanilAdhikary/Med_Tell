import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CertificatesService } from './certificates.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  @Get()
  @Roles('patient')
  listForPatient(@CurrentUser() user: AuthUser) {
    return this.certificatesService.listForPatient(user.patientId!);
  }

  @Get('all')
  @Roles('doctor')
  listAll() {
    return this.certificatesService.listAll({ status: 'awaiting-doctor' });
  }

  @Get(':id/pdf')
  @Roles('patient', 'doctor')
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    // Patients only download their own certificates; doctors review any.
    const filePath = await this.certificatesService.pdfPath(
      id,
      user.role === 'patient' ? user.patientId! : undefined,
    );
    try {
      return new StreamableFile(createReadStream(filePath), {
        type: 'application/pdf',
        disposition: `inline; filename="certificate-${id}.pdf"`,
      });
    } catch {
      throw new NotFoundException('Certificate PDF not found on disk');
    }
  }
}
