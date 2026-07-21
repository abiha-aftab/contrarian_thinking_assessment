import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from '../../src/health/health.service';

describe('HealthService', () => {
  const prisma = {
    $queryRawUnsafe: jest.fn(),
  };
  const redis = {
    ping: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports ready when PostgreSQL and Redis respond', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ result: 1 }]);
    redis.ping.mockResolvedValue('PONG');
    const service = new HealthService(prisma as never, redis as never);

    await expect(service.readiness()).resolves.toEqual({
      status: 'ok',
      checks: {
        database: 'up',
        redis: 'up',
      },
    });
  });

  it('rejects readiness when a dependency is unavailable', async () => {
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('database unavailable'));
    redis.ping.mockResolvedValue('PONG');
    const service = new HealthService(prisma as never, redis as never);

    await expect(service.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
