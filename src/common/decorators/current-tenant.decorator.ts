import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  AuthenticatedRequest,
  AuthenticatedTenant,
} from '../guards/api-key.guard';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedTenant =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().tenant,
);
