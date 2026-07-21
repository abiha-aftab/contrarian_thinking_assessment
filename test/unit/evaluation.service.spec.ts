import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EvaluationService } from '../../src/evaluation/evaluation.service';

const TENANT = {
  id: 'tenant-1',
  name: 'Checkout App',
  slug: 'checkout-app',
  keyPrefix: 'VJJd26vW',
};

function dbFlag(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flag-1',
    tenantId: TENANT.id,
    key: 'new-checkout',
    type: 'boolean',
    defaultValue: false,
    status: 'active',
    configs: [
      {
        enabled: true,
        rolloutPercentage: 100,
        targetingRules: null,
        variantValue: null,
        environment: { name: 'production' },
      },
    ],
    ...overrides,
  };
}

describe('EvaluationService', () => {
  const redis = { get: jest.fn(), set: jest.fn() };
  const prisma = {
    featureFlag: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const metrics = {
    recordEvaluation: jest.fn(),
    recordCacheEvent: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function service(): EvaluationService {
    return new EvaluationService(
      prisma as never,
      redis as never,
      metrics as never,
    );
  }

  describe('evaluateOne', () => {
    const dto = {
      tenant_id: TENANT.id,
      environment: 'production' as const,
      user_id: 'user-123',
      flag_key: 'new-checkout',
      context: {},
    };

    it('rejects evaluation for a different tenant than the API key', async () => {
      await expect(
        service().evaluateOne(TENANT, { ...dto, tenant_id: 'other-tenant' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('serves from the cache without touching the database on a hit', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          key: 'new-checkout',
          type: 'boolean',
          defaultValue: false,
          status: 'active',
          config: {
            enabled: true,
            rolloutPercentage: 100,
            targetingRules: null,
            variantValue: null,
          },
        }),
      );

      const result = await service().evaluateOne(TENANT, dto);

      expect(result).toEqual({
        flag_key: 'new-checkout',
        value: true,
        reason: 'rollout',
      });
      expect(prisma.featureFlag.findUnique).not.toHaveBeenCalled();
      expect(metrics.recordCacheEvent).toHaveBeenCalledWith('hit');
    });

    it('loads from the database and populates the cache on a miss', async () => {
      redis.get.mockResolvedValue(null);
      prisma.featureFlag.findUnique.mockResolvedValue(dbFlag());

      const result = await service().evaluateOne(TENANT, dto);

      expect(result.value).toBe(true);
      expect(redis.set).toHaveBeenCalledWith(
        'flagcfg:tenant-1:production:new-checkout',
        expect.any(String),
        'EX',
        300,
      );
      expect(metrics.recordCacheEvent).toHaveBeenCalledWith('miss');
    });

    it('returns not found for an unknown flag', async () => {
      redis.get.mockResolvedValue(null);
      prisma.featureFlag.findUnique.mockResolvedValue(null);

      await expect(service().evaluateOne(TENANT, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('serves the default value for an archived flag', async () => {
      redis.get.mockResolvedValue(null);
      prisma.featureFlag.findUnique.mockResolvedValue(
        dbFlag({ status: 'archived' }),
      );

      const result = await service().evaluateOne(TENANT, dto);

      expect(result).toEqual({
        flag_key: 'new-checkout',
        value: false,
        reason: 'archived',
      });
    });

    it('records the evaluation metric with the tenant', async () => {
      redis.get.mockResolvedValue(null);
      prisma.featureFlag.findUnique.mockResolvedValue(dbFlag());

      await service().evaluateOne(TENANT, dto);

      expect(metrics.recordEvaluation).toHaveBeenCalledWith(
        TENANT.id,
        'single',
        expect.any(Number),
      );
    });
  });

  describe('evaluateBulk', () => {
    const dto = {
      tenant_id: TENANT.id,
      environment: 'production' as const,
      user_id: 'user-123',
      context: { country: 'US' },
    };

    it('evaluates every active flag for the tenant and environment', async () => {
      prisma.featureFlag.findMany.mockResolvedValue([
        dbFlag(),
        dbFlag({
          id: 'flag-2',
          key: 'banner-text',
          type: 'string',
          defaultValue: 'control',
          configs: [
            {
              enabled: false,
              rolloutPercentage: 0,
              targetingRules: null,
              variantValue: 'variant-a',
              environment: { name: 'production' },
            },
          ],
        }),
      ]);

      const result = await service().evaluateBulk(TENANT, dto);

      expect(prisma.featureFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT.id,
            status: 'active',
          }),
        }),
      );
      expect(result.flags).toEqual({
        'new-checkout': { value: true, reason: 'rollout' },
        'banner-text': { value: 'control', reason: 'disabled' },
      });
      expect(metrics.recordEvaluation).toHaveBeenCalledWith(
        TENANT.id,
        'bulk',
        expect.any(Number),
      );
    });

    it('rejects evaluation for a different tenant than the API key', async () => {
      await expect(
        service().evaluateBulk(TENANT, { ...dto, tenant_id: 'other-tenant' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('skips flags that have no config for the environment', async () => {
      prisma.featureFlag.findMany.mockResolvedValue([dbFlag({ configs: [] })]);

      const result = await service().evaluateBulk(TENANT, dto);

      expect(result.flags).toEqual({});
    });
  });
});
