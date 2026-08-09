import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString } from 'class-validator';
import { createReadStream, existsSync } from 'node:fs';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DocumentsService } from './documents.service';

class AnalyzeBody {
  @IsOptional()
  @IsString()
  language?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload')
  @Roles('patient')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const doc = await this.documentsService.create(user.patientId!, file);
    return doc;
  }

  @Post(':id/analyze')
  @Roles('patient')
  async analyze(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: AnalyzeBody,
  ) {
    return this.documentsService.analyze(
      id,
      body.language ?? 'en',
      user.patientId!,
    );
  }

  @Get()
  @Roles('patient')
  listForPatient(@CurrentUser() user: AuthUser) {
    return this.documentsService.listForPatient(user.patientId!);
  }

  @Get('all')
  @Roles('doctor')
  listAll() {
    return this.documentsService.listAll({ status: 'awaiting-doctor' });
  }

  @Get(':id/file')
  @Roles('patient', 'doctor')
  async file(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    // Patients only see their own records; doctors review any.
    const doc = await this.documentsService.findOwned(
      id,
      user.role === 'patient' ? user.patientId! : undefined,
    );
    if (!existsSync(doc.filePath)) {
      throw new NotFoundException('Document file not found on disk');
    }
    return new StreamableFile(createReadStream(doc.filePath), {
      type: doc.mimeType ?? 'application/octet-stream',
      disposition: `inline; filename="${encodeURIComponent(doc.filename)}"`,
    });
  }
}
