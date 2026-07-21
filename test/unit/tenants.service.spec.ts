import { ConflictException } from '@nestjs/common';
import { TenantsService } from '../../src/tenants/tenants.service';

type TransactionCallback = (tx: unknown) => Promise<unknown>;

interface TenantCreateArgs {
  data: {
    name: string;
    slug: string;
    environments: { create: { name: string }[] };
    apiKeys: { create: { keyHash: string; keyPrefix: string } };
  };
}

describe('TenantsService', () => {
  const tenantCreate = jest.fn<Promise<unknown>, [TenantCreateArgs]>();
  const prisma = {
    $transaction: jest.fn((callback: TransactionCallback) =>
      callback({ tenant: { create: tenantCreate } }),
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a tenant with three environments and returns the API key once', async () => {
    tenantCreate.mockImplementation(({ data }: TenantCreateArgs) =>
      Promise.resolve({
        id: 'tenant-1',
        name: data.name,
        slug: data.slug,
        createdAt: new Date('2026-07-21T00:00:00Z'),
        environments: data.environments.create.map((env, index) => ({
          id: `env-${index}`,
          name: env.name,
        })),
      }),
    );
    const service = new TenantsService(prisma as never);

    const result = await service.createTenant({ name: 'Checkout App' });

    expect(result.tenant.slug).toBe('checkout-app');
    expect(result.tenant.environments.map((env) => env.name)).toEqual([
      'development',
      'staging',
      'production',
    ]);
    expect(result.apiKey).toMatch(/^ffk_/);

    const createArgs: TenantCreateArgs = tenantCreate.mock.calls[0][0];
    expect(createArgs.data.apiKeys.create.keyHash).not.toBe(result.apiKey);
    expect(result.apiKey).toContain(createArgs.data.apiKeys.create.keyPrefix);
  });

  it('raises a conflict when the tenant slug already exists', async () => {
    tenantCreate.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const service = new TenantsService(prisma as never);

    await expect(
      service.createTenant({ name: 'Checkout App' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
