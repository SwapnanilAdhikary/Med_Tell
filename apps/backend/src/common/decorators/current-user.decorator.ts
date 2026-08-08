import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthedRequest } from '../guards/jwt-auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    return request.user;
  },
);
