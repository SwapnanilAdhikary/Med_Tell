import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
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
}
