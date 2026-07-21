import { ConflictException, Injectable } from '@nestjs/common';
import { EnvironmentName } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { generateApiKey } from './api-key.util';
import { CreateTenantDto } from './dto/create-tenant.dto';

const ENVIRONMENT_NAMES: EnvironmentName[] = [
  EnvironmentName.development,
  EnvironmentName.staging,
  EnvironmentName.production,
];

export interface CreatedTenant {
  tenant: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    environments: { id: string; name: EnvironmentName }[];
  };
  apiKey: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTenant(dto: CreateTenantDto): Promise<CreatedTenant> {
    const key = generateApiKey();

    try {
      const tenant = await this.prisma.$transaction(async (tx) =>
        tx.tenant.create({
          data: {
            name: dto.name,
            slug: slugify(dto.name),
            environments: {
              create: ENVIRONMENT_NAMES.map((name) => ({ name })),
            },
            apiKeys: {
              create: {
                keyHash: key.hash,
                keyPrefix: key.prefix,
              },
            },
          },
          include: {
            environments: { orderBy: { name: 'asc' } },
          },
        }),
      );

      return {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          createdAt: tenant.createdAt,
          environments: tenant.environments.map((env) => ({
            id: env.id,
            name: env.name,
          })),
        },
        apiKey: key.plaintext,
      };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          `A tenant with the slug "${slugify(dto.name)}" already exists`,
        );
      }
      throw error;
    }
  }
}
