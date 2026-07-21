import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly evaluationDuration = new Histogram({
    name: 'flag_evaluation_duration_seconds',
    help: 'Flag evaluation latency in seconds',
    labelNames: ['tenant', 'mode'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [this.registry],
  });

  private readonly evaluationsTotal = new Counter({
    name: 'flag_evaluations_total',
    help: 'Total flag evaluations',
    labelNames: ['tenant', 'mode'],
    registers: [this.registry],
  });

  private readonly cacheEvents = new Counter({
    name: 'flag_config_cache_events_total',
    help: 'Flag config cache hits and misses',
    labelNames: ['result'],
    registers: [this.registry],
  });

  private readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests by route and status',
    labelNames: ['method', 'route', 'status', 'tenant'],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  recordEvaluation(
    tenantId: string,
    mode: 'single' | 'bulk',
    durationSeconds: number,
  ): void {
    this.evaluationsTotal.inc({ tenant: tenantId, mode });
    this.evaluationDuration.observe(
      { tenant: tenantId, mode },
      durationSeconds,
    );
  }

  recordCacheEvent(result: 'hit' | 'miss'): void {
    this.cacheEvents.inc({ result });
  }

  recordHttpRequest(
    method: string,
    route: string,
    status: number,
    tenantId?: string,
  ): void {
    this.httpRequests.inc({
      method,
      route,
      status: String(status),
      tenant: tenantId ?? 'anonymous',
    });
  }

  metricsText(): Promise<string> {
    return this.registry.metrics();
  }
}
