import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VapiWebhookGuard } from './vapi-webhook.guard';

function contextWith(headers: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function guardWith(secret: string): VapiWebhookGuard {
  return new VapiWebhookGuard({
    get: () => secret,
  } as unknown as ConfigService);
}

describe('VapiWebhookGuard', () => {
  it('allows everything when no secret is configured', () => {
    // The default dev path has no tunnel and no webhook, so failing closed here
    // would break it for no security gain.
    expect(guardWith('').canActivate(contextWith({}))).toBe(true);
  });

  it('allows a request carrying the matching secret', () => {
    expect(
      guardWith('s3cret').canActivate(contextWith({ 'x-vapi-secret': 's3cret' })),
    ).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(() =>
      guardWith('s3cret').canActivate(contextWith({ 'x-vapi-secret': 'nope' })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a missing header once a secret is configured', () => {
    expect(() => guardWith('s3cret').canActivate(contextWith({}))).toThrow(
      UnauthorizedException,
    );
  });
});
