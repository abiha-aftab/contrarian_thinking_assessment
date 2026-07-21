import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FlagsService } from '../../src/flags/flags.service';

const ACTOR = 'apikey:VJJd26vW';
const TENANT_ID = 'tenant-1';

function flagRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flag-1',
    tenantId: TENANT_ID,
    key: 'new-checkout',
    description: 'New checkout flow',
    type: 'boolean',
    defaultValue: false,
    status: 'active',
    createdAt: new Date('2026-07-21T00:00:00Z'),
    updatedAt: new Date('2026-07-21T00:00:00Z'),
    configs: [
      {
        id: 'cfg-dev',
        enabled: false,
        rolloutPercentage: 0,
        targetingRules: null,
        variantValue: null,
        environment: { id: 'env-dev', name: 'development' },
      },
      {
        id: 'cfg-stg',
        enabled: false,
        rolloutPercentage: 0,
        targetingRules: null,
        variantValue: null,
        environment: { id: 'env-stg', name: 'staging' },
      },
      {
        id: 'cfg-prod',
        enabled: false,
        rolloutPercentage: 0,
        targetingRules: null,
        variantValue: null,
        environment: { id: 'env-prod', name: 'production' },
      },
    ],
    ...overrides,
  };
}

describe('FlagsService', () => {
  const tx = {
    featureFlag: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    flagEnvironmentConfig: { update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    environment: { findMany: jest.fn() },
    featureFlag: { findMany: jest.fn(), findUnique: jest.fn() },
    auditLog: { findMany: jest.fn() },
    $transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const cache = { invalidate: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function service(): FlagsService {
    return new FlagsService(prisma as never, cache as never);
  }

  describe('createFlag', () => {
    it('creates a flag with a config per tenant environment and audits it', async () => {
      prisma.environment.findMany.mockResolvedValue([
        { id: 'env-dev', name: 'development' },
        { id: 'env-stg', name: 'staging' },
        { id: 'env-prod', name: 'production' },
      ]);
      tx.featureFlag.create.mockResolvedValue(flagRecord());

      const result = await service().createFlag(
        TENANT_ID,
        {
          key: 'new-checkout',
          description: 'New checkout flow',
          type: 'boolean',
          defaultValue: false,
        },
        ACTOR,
      );

      expect(result.key).toBe('new-checkout');
      expect(Object.keys(result.environments)).toEqual([
        'development',
        'staging',
        'production',
      ]);

      const createArgs = tx.featureFlag.create.mock.calls[0][0] as {
        data: { configs: { create: { environmentId: string }[] } };
      };
      expect(createArgs.data.configs.create).toHaveLength(3);

      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          flagId: 'flag-1',
          actor: ACTOR,
          action: 'created',
        }),
      });
    });

    it('rejects a default value that does not match the flag type', async () => {
      await expect(
        service().createFlag(
          TENANT_ID,
          {
            key: 'new-checkout',
            type: 'boolean',
            defaultValue: 'yes',
          },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('raises a conflict when the flag key already exists for the tenant', async () => {
      prisma.environment.findMany.mockResolvedValue([
        { id: 'env-dev', name: 'development' },
      ]);
      tx.featureFlag.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        }),
      );

      await expect(
        service().createFlag(
          TENANT_ID,
          { key: 'new-checkout', type: 'boolean', defaultValue: false },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateFlag', () => {
    it('updates an environment config and audits before and after values', async () => {
      tx.featureFlag.findUnique.mockResolvedValue(flagRecord());

      const result = await service().updateFlag(
        TENANT_ID,
        'new-checkout',
        { environment: 'production', enabled: true, rolloutPercentage: 25 },
        ACTOR,
      );

      expect(tx.flagEnvironmentConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg-prod' },
        data: expect.objectContaining({
          enabled: true,
          rolloutPercentage: 25,
        }),
      });

      const auditArgs = tx.auditLog.create.mock.calls[0][0] as {
        data: {
          action: string;
          beforeValue: { environments: Record<string, { enabled: boolean }> };
          afterValue: { environments: Record<string, { enabled: boolean }> };
        };
      };
      expect(auditArgs.data.action).toBe('updated');
      expect(auditArgs.data.beforeValue.environments.production.enabled).toBe(
        false,
      );
      expect(auditArgs.data.afterValue.environments.production.enabled).toBe(
        true,
      );

      expect(result.environments.production.enabled).toBe(true);
      expect(result.environments.production.rolloutPercentage).toBe(25);
      expect(cache.invalidate).toHaveBeenCalledWith(TENANT_ID, 'new-checkout');
    });

    it('updates the default value when it matches the flag type', async () => {
      tx.featureFlag.findUnique.mockResolvedValue(flagRecord());

      const result = await service().updateFlag(
        TENANT_ID,
        'new-checkout',
        { defaultValue: true },
        ACTOR,
      );

      expect(tx.featureFlag.update).toHaveBeenCalledWith({
        where: { id: 'flag-1' },
        data: expect.objectContaining({ defaultValue: true }),
      });
      expect(result.defaultValue).toBe(true);
    });

    it('rejects a default value that does not match the flag type', async () => {
      tx.featureFlag.findUnique.mockResolvedValue(flagRecord());

      await expect(
        service().updateFlag(
          TENANT_ID,
          'new-checkout',
          { defaultValue: 'yes' },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects environment-scoped fields without an environment', async () => {
      tx.featureFlag.findUnique.mockResolvedValue(flagRecord());

      await expect(
        service().updateFlag(
          TENANT_ID,
          'new-checkout',
          { enabled: true },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns not found for a missing or archived flag', async () => {
      tx.featureFlag.findUnique.mockResolvedValueOnce(null);
      await expect(
        service().updateFlag(
          TENANT_ID,
          'missing',
          { defaultValue: true },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      tx.featureFlag.findUnique.mockResolvedValueOnce(
        flagRecord({ status: 'archived' }),
      );
      await expect(
        service().updateFlag(
          TENANT_ID,
          'new-checkout',
          { defaultValue: true },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('archiveFlag', () => {
    it('soft-deletes the flag and audits the archive', async () => {
      tx.featureFlag.findUnique.mockResolvedValue(flagRecord());

      const result = await service().archiveFlag(
        TENANT_ID,
        'new-checkout',
        ACTOR,
      );

      expect(tx.featureFlag.update).toHaveBeenCalledWith({
        where: { id: 'flag-1' },
        data: { status: 'archived' },
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'archived' }),
      });
      expect(result.status).toBe('archived');
      expect(cache.invalidate).toHaveBeenCalledWith(TENANT_ID, 'new-checkout');
    });

    it('returns not found when archiving a flag that is already archived', async () => {
      tx.featureFlag.findUnique.mockResolvedValue(
        flagRecord({ status: 'archived' }),
      );

      await expect(
        service().archiveFlag(TENANT_ID, 'new-checkout', ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listFlags', () => {
    it('filters by status through the query', async () => {
      prisma.featureFlag.findMany.mockResolvedValue([flagRecord()]);

      const result = await service().listFlags(TENANT_ID, {
        status: 'active',
      });

      expect(prisma.featureFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, status: 'active' },
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('new-checkout');
    });

    it('narrows the environment view when an environment filter is given', async () => {
      prisma.featureFlag.findMany.mockResolvedValue([flagRecord()]);

      const result = await service().listFlags(TENANT_ID, {
        environment: 'production',
      });

      expect(Object.keys(result[0].environments)).toEqual(['production']);
    });
  });

  describe('getHistory', () => {
    it('returns the chronological audit trail for a flag', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(flagRecord());
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'audit-2',
          actor: ACTOR,
          action: 'updated',
          beforeValue: {},
          afterValue: {},
          createdAt: new Date('2026-07-21T01:00:00Z'),
        },
        {
          id: 'audit-1',
          actor: ACTOR,
          action: 'created',
          beforeValue: null,
          afterValue: {},
          createdAt: new Date('2026-07-21T00:00:00Z'),
        },
      ]);

      const history = await service().getHistory(TENANT_ID, 'new-checkout');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, flagId: 'flag-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(history).toHaveLength(2);
      expect(history[0].action).toBe('updated');
    });

    it('returns not found for an unknown flag', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(null);

      await expect(
        service().getHistory(TENANT_ID, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
