import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ChatService } from './chat.service';

class MessageBody {
  @IsString()
  message: string;
}

class DoctorMessageBody {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message: string;
}

class LanguageBody {
  @IsString()
  language: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('message')
  @Roles('patient')
  async message(@CurrentUser() user: AuthUser, @Body() body: MessageBody) {
    return this.chatService.sendMessage(user.patientId!, body.message);
  }

  @Post('document')
  @Roles('patient')
  @UseInterceptors(FileInterceptor('file'))
  async document(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.chatService.sendDocument(user.patientId!, file);
  }

  @Get('history')
  @Roles('patient')
  async history(@CurrentUser() user: AuthUser) {
    return this.chatService.getMessages(user.patientId!);
  }

  @Post('language')
  @Roles('patient')
  async setLanguage(@CurrentUser() user: AuthUser, @Body() body: LanguageBody) {
    return this.chatService.setLanguage(user.patientId!, body.language);
  }

  // A doctor reads and writes any patient's thread; that is the review job. The
  // patient id is a path param rather than a body field so it cannot be
  // silently stripped by ValidationPipe({whitelist:true}).
  @Get('doctor/:patientId')
  @Roles('doctor')
  doctorHistory(@Param('patientId') patientId: string) {
    return this.chatService.getMessages(patientId);
  }

  @Post('doctor/:patientId/message')
  @Roles('doctor')
  doctorMessage(
    @CurrentUser() user: AuthUser,
    @Param('patientId') patientId: string,
    @Body() body: DoctorMessageBody,
  ) {
    return this.chatService.doctorMessage(
      user.doctorId!,
      patientId,
      body.message,
    );
  }

  @Post('doctor/:patientId/handoff')
  @Roles('doctor')
  handoff(
    @CurrentUser() user: AuthUser,
    @Param('patientId') patientId: string,
  ) {
    return this.chatService.setHandoff(user.doctorId!, patientId, true);
  }

  @Post('doctor/:patientId/release')
  @Roles('doctor')
  release(@Param('patientId') patientId: string) {
    return this.chatService.setHandoff(undefined, patientId, false);
  }
}
