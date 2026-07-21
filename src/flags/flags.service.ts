import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FlagConfigCacheService } from '../cache/flag-config-cache.service';
import { PrismaService } from '../database/prisma.service';
import { CreateFlagDto } from './dto/create-flag.dto';
import { ListFlagsQuery } from './dto/list-flags.query';
import { UpdateFlagDto } from './dto/update-flag.dto';
import { assertValueMatchesType, FlagValueType } from './value-type.util';

interface EnvironmentConfigRecord {
  id: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetingRules: unknown;
  variantValue: unknown;
  environment: { id: string; name: string };
}

interface FlagRecord {
  id: string;
  tenantId: string;
  key: string;
  description: string | null;
  type: FlagValueType;
  defaultValue: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  configs: EnvironmentConfigRecord[];
}

export interface EnvironmentConfigView {
  enabled: boolean;
  rolloutPercentage: number;
  targetingRules: unknown;
  variantValue: unknown;
}

export interface FlagView {
  key: string;
  description: string | null;
  type: FlagValueType;
  defaultValue: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  environments: Record<string, EnvironmentConfigView>;
}

export interface FlagHistoryEntry {
  id: string;
  actor: string;
  action: string;
  beforeValue: unknown;
  afterValue: unknown;
  createdAt: Date;
}

const FLAG_INCLUDE = {
  configs: { include: { environment: true } },
} as const;

function snapshot(flag: FlagRecord): Record<string, unknown> {
  return {
    description: flag.description,
    type: flag.type,
    defaultValue: flag.defaultValue,
    status: flag.status,
    environments: Object.fromEntries(
      flag.configs.map((config) => [
        config.environment.name,
        {
          enabled: config.enabled,
          rolloutPercentage: config.rolloutPercentage,
          targetingRules: config.targetingRules,
          variantValue: config.variantValue,
        },
      ]),
    ),
  };
}

function serialize(flag: FlagRecord, environment?: string): FlagView {
  const configs = environment
    ? flag.configs.filter((config) => config.environment.name === environment)
    : flag.configs;

  return {
    key: flag.key,
    description: flag.description,
    type: flag.type,
    defaultValue: flag.defaultValue,
    status: flag.status,
    createdAt: flag.createdAt,
    updatedAt: flag.updatedAt,
    environments: Object.fromEntries(
      configs.map((config) => [
        config.environment.name,
        {
          enabled: config.enabled,
          rolloutPercentage: config.rolloutPercentage,
          targetingRules: config.targetingRules,
          variantValue: config.variantValue,
        },
      ]),
    ),
  };
}

function applyUpdates(flag: FlagRecord, dto: UpdateFlagDto): FlagRecord {
  return {
    ...flag,
    description: dto.description ?? flag.description,
    defaultValue:
      dto.defaultValue !== undefined ? dto.defaultValue : flag.defaultValue,
    configs: flag.configs.map((config) => {
      if (config.environment.name !== dto.environment) {
        return config;
      }
      return {
        ...config,
        enabled: dto.enabled ?? config.enabled,
        rolloutPercentage: dto.rolloutPercentage ?? config.rolloutPercentage,
        targetingRules:
          dto.targetingRules !== undefined
            ? dto.targetingRules
            : config.targetingRules,
        variantValue:
          dto.variantValue !== undefined
            ? dto.variantValue
            : config.variantValue,
      };
    }),
  };
}

@Injectable()
export class FlagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: FlagConfigCacheService,
  ) {}

  async createFlag(
    tenantId: string,
    dto: CreateFlagDto,
    actor: string,
  ): Promise<FlagView> {
    assertValueMatchesType(dto.type, dto.defaultValue);

    const environments = await this.prisma.environment.findMany({
      where: { tenantId },
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const flag = (await tx.featureFlag.create({
          data: {
            tenantId,
            key: dto.key,
            description: dto.description,
            type: dto.type,
            defaultValue: dto.defaultValue,
            configs: {
              create: environments.map((environment) => ({
                environmentId: environment.id,
              })),
            },
          },
          include: FLAG_INCLUDE,
        })) as unknown as FlagRecord;

        await tx.auditLog.create({
          data: {
            tenantId,
            flagId: flag.id,
            actor,
            action: 'created',
            afterValue: snapshot(flag) as Prisma.InputJsonValue,
          },
        });

        return serialize(flag);
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          `A flag with the key "${dto.key}" already exists for this tenant`,
        );
      }
      throw error;
    }
  }

  async listFlags(
    tenantId: string,
    query: ListFlagsQuery,
  ): Promise<FlagView[]> {
    const flags = (await this.prisma.featureFlag.findMany({
      where: {
        tenantId,
        ...(query.status && { status: query.status }),
      },
      include: FLAG_INCLUDE,
      orderBy: { key: 'asc' },
    })) as unknown as FlagRecord[];

    return flags.map((flag) => serialize(flag, query.environment));
  }

  async updateFlag(
    tenantId: string,
    flagKey: string,
    dto: UpdateFlagDto,
    actor: string,
  ): Promise<FlagView> {
    const touchesEnvironmentConfig = [
      dto.enabled,
      dto.rolloutPercentage,
      dto.targetingRules,
      dto.variantValue,
    ].some((value) => value !== undefined);

    if (touchesEnvironmentConfig && !dto.environment) {
      throw new BadRequestException(
        'An "environment" is required when updating enabled, rolloutPercentage, targetingRules, or variantValue',
      );
    }

    const view = await this.prisma.$transaction(async (tx) => {
      const flag = (await tx.featureFlag.findUnique({
        where: { tenantId_key: { tenantId, key: flagKey } },
        include: FLAG_INCLUDE,
      })) as unknown as FlagRecord | null;

      if (!flag || flag.status === 'archived') {
        throw new NotFoundException(`Flag "${flagKey}" was not found`);
      }

      if (dto.defaultValue !== undefined) {
        assertValueMatchesType(flag.type, dto.defaultValue);
      }
      if (dto.variantValue !== undefined) {
        assertValueMatchesType(flag.type, dto.variantValue);
      }

      const before = snapshot(flag);

      if (dto.description !== undefined || dto.defaultValue !== undefined) {
        await tx.featureFlag.update({
          where: { id: flag.id },
          data: {
            ...(dto.description !== undefined && {
              description: dto.description,
            }),
            ...(dto.defaultValue !== undefined && {
              defaultValue: dto.defaultValue,
            }),
          },
        });
      }

      if (dto.environment) {
        const config = flag.configs.find(
          (candidate) => candidate.environment.name === dto.environment,
        );
        if (!config) {
          throw new NotFoundException(
            `Environment "${dto.environment}" was not found for this flag`,
          );
        }

        await tx.flagEnvironmentConfig.update({
          where: { id: config.id },
          data: {
            ...(dto.enabled !== undefined && { enabled: dto.enabled }),
            ...(dto.rolloutPercentage !== undefined && {
              rolloutPercentage: dto.rolloutPercentage,
            }),
            ...(dto.targetingRules !== undefined && {
              targetingRules:
                dto.targetingRules as unknown as Prisma.InputJsonValue,
            }),
            ...(dto.variantValue !== undefined && {
              variantValue: dto.variantValue,
            }),
          },
        });
      }

      const updated = applyUpdates(flag, dto);

      await tx.auditLog.create({
        data: {
          tenantId,
          flagId: flag.id,
          actor,
          action: 'updated',
          beforeValue: before as Prisma.InputJsonValue,
          afterValue: snapshot(updated) as Prisma.InputJsonValue,
        },
      });

      return serialize(updated);
    });

    await this.cache.invalidate(tenantId, flagKey);
    return view;
  }

  async archiveFlag(
    tenantId: string,
    flagKey: string,
    actor: string,
  ): Promise<FlagView> {
    const view = await this.prisma.$transaction(async (tx) => {
      const flag = (await tx.featureFlag.findUnique({
        where: { tenantId_key: { tenantId, key: flagKey } },
        include: FLAG_INCLUDE,
      })) as unknown as FlagRecord | null;

      if (!flag || flag.status === 'archived') {
        throw new NotFoundException(`Flag "${flagKey}" was not found`);
      }

      const before = snapshot(flag);

      await tx.featureFlag.update({
        where: { id: flag.id },
        data: { status: 'archived' },
      });

      const archived: FlagRecord = { ...flag, status: 'archived' };

      await tx.auditLog.create({
        data: {
          tenantId,
          flagId: flag.id,
          actor,
          action: 'archived',
          beforeValue: before as Prisma.InputJsonValue,
          afterValue: snapshot(archived) as Prisma.InputJsonValue,
        },
      });

      return serialize(archived);
    });

    await this.cache.invalidate(tenantId, flagKey);
    return view;
  }

  async getHistory(
    tenantId: string,
    flagKey: string,
  ): Promise<FlagHistoryEntry[]> {
    const flag = (await this.prisma.featureFlag.findUnique({
      where: { tenantId_key: { tenantId, key: flagKey } },
    })) as { id: string } | null;

    if (!flag) {
      throw new NotFoundException(`Flag "${flagKey}" was not found`);
    }

    const entries = await this.prisma.auditLog.findMany({
      where: { tenantId, flagId: flag.id },
      orderBy: { createdAt: 'desc' },
    });

    return entries.map((entry) => ({
      id: entry.id,
      actor: entry.actor,
      action: entry.action,
      beforeValue: entry.beforeValue,
      afterValue: entry.afterValue,
      createdAt: entry.createdAt,
    }));
  }
}
