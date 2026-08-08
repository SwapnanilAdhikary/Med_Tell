import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Types } from 'mongoose';

export interface AuthUser {
  userId: string;
  role: string;
  phone: string;
  patientId?: string;
  doctorId?: string;
}

export interface AuthedRequest extends Request {
  user: AuthUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    try {
      const payload = await this.jwtService.verifyAsync(token);
      if (!payload.sub) throw new UnauthorizedException('Invalid token');
      request.user = {
        userId: String(payload.sub),
        role: payload.role as string,
        phone: payload.phone as string,
        patientId: payload.patientId as string | undefined,
        doctorId: payload.doctorId as string | undefined,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

export type AuthUserObjectId = Types.ObjectId;
