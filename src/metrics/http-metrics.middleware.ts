import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from '../common/guards/api-key.guard';
import { MetricsService } from './metrics.service';

// Requests that match no route are labelled with a constant so that scanners
// probing random URLs cannot blow up the metric's label cardinality.
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * Records every HTTP response, including ones rejected by guards (401, 403,
 * 429) which never reach a Nest interceptor. The tenant label is read when the
 * response finishes, after the API key guard has had a chance to set it.
 */
export function httpMetricsMiddleware(metrics: MetricsService) {
  return (
    request: AuthenticatedRequest,
    response: Response,
    next: NextFunction,
  ): void => {
    response.on('finish', () => {
      const route = (request.route as { path?: string } | undefined)?.path;
      metrics.recordHttpRequest(
        request.method,
        route ?? UNMATCHED_ROUTE,
        response.statusCode,
        request.tenant?.id,
      );
    });
    next();
  };
}
