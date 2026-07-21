import { ExecutionContext, HttpException } from '@nestjs/common';
import { RateLimitGuard } from '../../src/rate-limit/rate-limit.guard';

function contextFor(
  request: Record<string, unknown>,
  response: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard', () => {
  const incr = jest.fn();
  const expire = jest.fn();
  const exec = jest.fn();
  const transaction = { incr, expire, exec };
  const redis = { multi: jest.fn(() => transaction) };

  function counterAt(count: number): void {
    exec.mockResolvedValue([
      [null, count],
      [null, 1],
    ]);
  }
  const config = {
    get: jest.fn().mockReturnValue(2),
  };
  const setHeader = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    incr.mockReturnValue(transaction);
    expire.mockReturnValue(transaction);
    config.get.mockReturnValue(2);
  });

  it('allows requests under the tenant limit', async () => {
    counterAt(1);
    const guard = new RateLimitGuard(redis as never, config as never);
    const request = { tenant: { id: 'tenant-1' } };

    await expect(
      guard.canActivate(contextFor(request, { setHeader })),
    ).resolves.toBe(true);
    expect(incr).toHaveBeenCalledWith(expect.stringContaining('tenant-1'));
  });

  it('sets the counter and its expiry in one transaction', async () => {
    counterAt(1);
    const guard = new RateLimitGuard(redis as never, config as never);
    const request = { tenant: { id: 'tenant-1' } };

    await guard.canActivate(contextFor(request, { setHeader }));

    expect(redis.multi).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith(
      expect.stringContaining('tenant-1'),
      60,
    );
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('rejects requests over the limit with HTTP 429 and Retry-After', async () => {
    counterAt(3);
    const guard = new RateLimitGuard(redis as never, config as never);
    const request = { tenant: { id: 'tenant-1' } };

    await expect(
      guard.canActivate(contextFor(request, { setHeader })),
    ).rejects.toMatchObject({ status: 429 } satisfies Partial<HttpException>);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('allows unauthenticated routes without touching Redis', async () => {
    const guard = new RateLimitGuard(redis as never, config as never);

    await expect(
      guard.canActivate(contextFor({}, { setHeader })),
    ).resolves.toBe(true);
    expect(redis.multi).not.toHaveBeenCalled();
  });
});
