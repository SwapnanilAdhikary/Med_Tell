import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Verifies the secret Vapi is told to send with every server request.
 *
 * `VAPI_WEB_SECRET` was being pushed to Vapi and checked by nothing, leaving an
 * unauthenticated endpoint that can create Patients and book appointments from
 * an arbitrary payload.
 *
 * No-ops when the secret is empty, which is the default: the tunnel-free dev
 * path has no webhook at all, and failing closed there would break it for no
 * security gain.
 */
@Injectable()
export class VapiWebhookGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('VAPI_WEB_SECRET', '');
    if (!expected) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-vapi-secret'];
    if (provided !== expected) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
    return true;
  }
}
