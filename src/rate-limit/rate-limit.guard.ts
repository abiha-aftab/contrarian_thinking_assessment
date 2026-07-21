import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { RedisService } from '../cache/redis.service';
import { AuthenticatedRequest } from '../common/guards/api-key.guard';

const WINDOW_SECONDS = 60;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenantId = request.tenant?.id;

    // Rate limiting is tenant-scoped; routes without an authenticated tenant
    // (e.g. tenant registration) are not limited here.
    if (!tenantId) {
      return true;
    }

    const limit = Number(this.config.get('RATE_LIMIT_PER_MINUTE', 300));
    const windowStart = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const key = `ratelimit:${tenantId}:${windowStart}`;

    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }

    if (count > limit) {
      const response = context.switchToHttp().getResponse<Response>();
      const secondsUntilNextWindow =
        WINDOW_SECONDS - Math.floor((Date.now() / 1000) % WINDOW_SECONDS);
      response.setHeader('Retry-After', secondsUntilNextWindow);
      throw new HttpException(
        'Rate limit exceeded for this tenant',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
