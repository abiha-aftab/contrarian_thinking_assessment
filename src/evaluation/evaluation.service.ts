import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { flagConfigCacheKey } from '../cache/flag-config-cache.service';
import { RedisService } from '../cache/redis.service';
import { AuthenticatedTenant } from '../common/guards/api-key.guard';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { EvaluateBulkDto, EvaluateDto } from './dto/evaluate.dto';
import {
  EvaluableFlag,
  EvaluationReason,
  evaluateFlag,
  TargetingRule,
} from './evaluation.engine';
import { FlagValueType } from '../flags/value-type.util';

const CONFIG_CACHE_TTL_SECONDS = 300;

interface DbFlagWithConfigs {
  key: string;
  type: FlagValueType;
  defaultValue: unknown;
  status: string;
  configs: {
    enabled: boolean;
    rolloutPercentage: number;
    targetingRules: unknown;
    variantValue: unknown;
    environment: { name: string };
  }[];
}

export interface SingleEvaluation {
  flag_key: string;
  value: unknown;
  reason: EvaluationReason;
}

export interface BulkEvaluation {
  environment: string;
  user_id: string;
  flags: Record<string, { value: unknown; reason: EvaluationReason }>;
}

function toEvaluable(
  flag: DbFlagWithConfigs,
  environment: string,
): EvaluableFlag | null {
  const config = flag.configs.find(
    (candidate) => candidate.environment.name === environment,
  );
  if (!config) {
    return null;
  }
  return {
    key: flag.key,
    type: flag.type,
    defaultValue: flag.defaultValue,
    status: flag.status,
    config: {
      enabled: config.enabled,
      rolloutPercentage: config.rolloutPercentage,
      targetingRules: config.targetingRules as TargetingRule[] | null,
      variantValue: config.variantValue,
    },
  };
}

@Injectable()
export class EvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
  ) {}

  async evaluateOne(
    tenant: AuthenticatedTenant,
    dto: EvaluateDto,
  ): Promise<SingleEvaluation> {
    this.assertTenantMatch(tenant, dto.tenant_id);
    const startedAt = process.hrtime.bigint();

    const flag = await this.loadEvaluableFlag(
      dto.tenant_id,
      dto.environment,
      dto.flag_key,
    );

    const result = evaluateFlag(flag, dto.user_id, dto.context ?? {});

    this.recordDuration(tenant.id, 'single', startedAt);
    return {
      flag_key: dto.flag_key,
      value: result.value,
      reason: result.reason,
    };
  }

  async evaluateBulk(
    tenant: AuthenticatedTenant,
    dto: EvaluateBulkDto,
  ): Promise<BulkEvaluation> {
    this.assertTenantMatch(tenant, dto.tenant_id);
    const startedAt = process.hrtime.bigint();

    const flags = (await this.prisma.featureFlag.findMany({
      where: { tenantId: dto.tenant_id, status: 'active' },
      include: { configs: { include: { environment: true } } },
    })) as unknown as DbFlagWithConfigs[];

    const evaluations: BulkEvaluation['flags'] = {};
    for (const flag of flags) {
      const evaluable = toEvaluable(flag, dto.environment);
      if (!evaluable) {
        continue;
      }
      const result = evaluateFlag(evaluable, dto.user_id, dto.context ?? {});
      evaluations[flag.key] = { value: result.value, reason: result.reason };
    }

    this.recordDuration(tenant.id, 'bulk', startedAt);
    return {
      environment: dto.environment,
      user_id: dto.user_id,
      flags: evaluations,
    };
  }

  private assertTenantMatch(
    tenant: AuthenticatedTenant,
    requestedTenantId: string,
  ): void {
    if (tenant.id !== requestedTenantId) {
      throw new ForbiddenException(
        'This API key does not grant access to the requested tenant',
      );
    }
  }

  /**
   * Loads a single flag's evaluable view through the Redis config cache.
   * The cache is invalidated on every flag mutation, and the 5-minute TTL
   * bounds staleness if an invalidation is ever missed.
   */
  private async loadEvaluableFlag(
    tenantId: string,
    environment: string,
    flagKey: string,
  ): Promise<EvaluableFlag> {
    const cacheKey = flagConfigCacheKey(tenantId, environment, flagKey);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.metrics.recordCacheEvent('hit');
      return JSON.parse(cached) as EvaluableFlag;
    }
    this.metrics.recordCacheEvent('miss');

    const flag = (await this.prisma.featureFlag.findUnique({
      where: { tenantId_key: { tenantId, key: flagKey } },
      include: { configs: { include: { environment: true } } },
    })) as unknown as DbFlagWithConfigs | null;

    const evaluable = flag ? toEvaluable(flag, environment) : null;
    if (!evaluable) {
      throw new NotFoundException(`Flag "${flagKey}" was not found`);
    }

    await this.redis.set(
      cacheKey,
      JSON.stringify(evaluable),
      'EX',
      CONFIG_CACHE_TTL_SECONDS,
    );

    return evaluable;
  }

  private recordDuration(
    tenantId: string,
    mode: 'single' | 'bulk',
    startedAt: bigint,
  ): void {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    this.metrics.recordEvaluation(tenantId, mode, seconds);
  }
}
