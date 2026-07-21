import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../cache/redis.service';
import { PrismaService } from '../database/prisma.service';

export interface ReadinessResult {
  status: 'ok';
  checks: {
    database: 'up';
    redis: 'up';
  };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async readiness(): Promise<ReadinessResult> {
    try {
      const [, redisResponse] = await Promise.all([
        this.prisma.$queryRawUnsafe('SELECT 1'),
        this.redis.ping(),
      ]);

      if (redisResponse !== 'PONG') {
        throw new Error('Unexpected Redis health response');
      }

      return {
        status: 'ok',
        checks: {
          database: 'up',
          redis: 'up',
        },
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        message: 'A required dependency is unavailable',
      });
    }
  }
}
