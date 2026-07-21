import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

const ENVIRONMENT_NAMES = ['development', 'staging', 'production'] as const;

export function flagConfigCacheKey(
  tenantId: string,
  environment: string,
  flagKey: string,
): string {
  return `flagcfg:${tenantId}:${environment}:${flagKey}`;
}

@Injectable()
export class FlagConfigCacheService {
  constructor(private readonly redis: RedisService) {}

  async invalidate(tenantId: string, flagKey: string): Promise<void> {
    await this.redis.del(
      ...ENVIRONMENT_NAMES.map((environment) =>
        flagConfigCacheKey(tenantId, environment, flagKey),
      ),
    );
  }
}
