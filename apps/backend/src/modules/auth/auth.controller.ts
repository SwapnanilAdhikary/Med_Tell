import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AuthService, RegisterDto, RegisterWorkerDto } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from './schemas/user.schema';

class RegisterWorkerBody implements RegisterWorkerDto {
  @IsOptional()
  @IsIn(['ASHA', 'ANM'])
  cadre?: 'ASHA' | 'ANM';

  @IsOptional()
  @IsString()
  workerCode?: string;

  @IsOptional()
  @IsString()
  village?: string;

  @IsOptional()
  @IsString()
  block?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];
}

class RegisterBody implements RegisterDto {
  @IsString()
  phone!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  name!: string;

  // ValidationPipe({whitelist:true}) makes this the real gate on the role -
  // widening only the service-side union does nothing.
  @IsOptional()
  @IsIn(['patient', 'doctor', 'health_worker'])
  role?: 'patient' | 'doctor' | 'health_worker';

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  title?: string;

  // Without @ValidateNested + @Type the whitelist strips this object silently.
  @IsOptional()
  @ValidateNested()
  @Type(() => RegisterWorkerBody)
  worker?: RegisterWorkerBody;
}

class LoginBody {
  @IsString()
  phone!: string;

  @IsString()
  password!: string;
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
