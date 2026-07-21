import { EventEmitter } from 'node:events';
import {
  httpMetricsMiddleware,
  UNMATCHED_ROUTE,
} from '../../src/metrics/http-metrics.middleware';

function fakeResponse(statusCode: number) {
  return Object.assign(new EventEmitter(), { statusCode });
}

describe('httpMetricsMiddleware', () => {
  const recordHttpRequest = jest.fn();
  const middleware = httpMetricsMiddleware({ recordHttpRequest } as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records nothing until the response finishes', () => {
    const next = jest.fn();
    const response = fakeResponse(200);

    middleware({ method: 'GET' } as never, response as never, next);

    expect(next).toHaveBeenCalled();
    expect(recordHttpRequest).not.toHaveBeenCalled();
  });

  it('labels a guard rejection with the route template and status', () => {
    const request = {
      method: 'GET',
      route: { path: '/api/v1/tenants/:tenantId/flags' },
    };
    const response = fakeResponse(401);

    middleware(request as never, response as never, jest.fn());
    response.emit('finish');

    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/api/v1/tenants/:tenantId/flags',
      401,
      undefined,
    );
  });

  it('reads the tenant set by the API key guard after the handler ran', () => {
    const request: Record<string, unknown> = {
      method: 'POST',
      route: { path: '/api/v1/evaluate' },
    };
    const response = fakeResponse(200);

    middleware(request as never, response as never, jest.fn());
    request.tenant = { id: 'tenant-1' };
    response.emit('finish');

    expect(recordHttpRequest).toHaveBeenCalledWith(
      'POST',
      '/api/v1/evaluate',
      200,
      'tenant-1',
    );
  });

  it('collapses unmatched URLs into one label', () => {
    const response = fakeResponse(404);

    middleware(
      { method: 'GET', url: '/wp-login.php?x=1' } as never,
      response as never,
      jest.fn(),
    );
    response.emit('finish');

    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      UNMATCHED_ROUTE,
      404,
      undefined,
    );
  });
});
