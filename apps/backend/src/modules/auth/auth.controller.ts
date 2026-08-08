import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService, RegisterDto } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from './schemas/user.schema';

class RegisterBody implements RegisterDto {
  @IsString()
  phone: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsIn(['patient', 'doctor'])
  role?: 'patient' | 'doctor';

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  title?: string;
}

class LoginBody {
  @IsString()
  phone: string;

  @IsString()
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: RegisterBody) {
    return this.authService.register(body);
  }

  @Post('login')
  login(@Body() body: LoginBody) {
    return this.authService.login(body.phone, body.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
