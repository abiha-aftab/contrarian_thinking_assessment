import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyGuard } from '../../src/common/guards/api-key.guard';
import { generateApiKey } from '../../src/tenants/api-key.util';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  const findMany = jest.fn();
  const prisma = { apiKey: { findMany } };
  const tenant = { id: 'tenant-1', name: 'Checkout App', slug: 'checkout-app' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attaches the tenant to the request for a valid key', async () => {
    const key = generateApiKey();
    findMany.mockResolvedValue([
      { keyHash: key.hash, keyPrefix: key.prefix, tenantId: tenant.id, tenant },
    ]);
    const guard = new ApiKeyGuard(prisma as never);
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${key.plaintext}` },
      params: {},
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.tenant).toEqual(tenant);
  });

  it('rejects requests without an Authorization bearer header', async () => {
    const guard = new ApiKeyGuard(prisma as never);
    const request = { headers: {}, params: {} };

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects unknown API keys', async () => {
    findMany.mockResolvedValue([]);
    const guard = new ApiKeyGuard(prisma as never);
    const key = generateApiKey();
    const request = {
      headers: { authorization: `Bearer ${key.plaintext}` },
      params: {},
    };

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('forbids access when the path tenant differs from the key tenant', async () => {
    const key = generateApiKey();
    findMany.mockResolvedValue([
      { keyHash: key.hash, keyPrefix: key.prefix, tenantId: tenant.id, tenant },
    ]);
    const guard = new ApiKeyGuard(prisma as never);
    const request = {
      headers: { authorization: `Bearer ${key.plaintext}` },
      params: { tenantId: 'another-tenant' },
    };

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
