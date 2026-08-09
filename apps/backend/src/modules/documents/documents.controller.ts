import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString } from 'class-validator';
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

  @Post('analyze')
  @Roles('patient')
  @UseInterceptors(FileInterceptor('file'))
  async analyze(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: AnalyzeBody,
  ) {
    return this.documentsService.analyzeUpload(
      user.patientId!,
      file,
      body.language ?? 'en',
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
}
