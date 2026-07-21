import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../database/prisma.service';
import {
  extractKeyPrefix,
  hashApiKey,
  hashesMatch,
} from '../../tenants/api-key.util';

export interface AuthenticatedTenant {
  id: string;
  name: string;
  slug: string;
  keyPrefix: string;
}

export interface AuthenticatedRequest extends Request {
  tenant: AuthenticatedTenant;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('An API key bearer token is required');
    }

    const key = header.slice('Bearer '.length).trim();
    const prefix = extractKeyPrefix(key);
    if (!prefix) {
      throw new UnauthorizedException('Invalid API key');
    }

    const candidates = await this.prisma.apiKey.findMany({
      where: { keyPrefix: prefix, active: true },
      include: { tenant: true },
    });

    const providedHash = hashApiKey(key);
    const matched = candidates.find((candidate) =>
      hashesMatch(candidate.keyHash, providedHash),
    );
    if (!matched) {
      throw new UnauthorizedException('Invalid API key');
    }

    const pathTenantId = request.params?.tenantId;
    if (pathTenantId && pathTenantId !== matched.tenantId) {
      throw new ForbiddenException(
        'This API key does not grant access to the requested tenant',
      );
    }

    request.tenant = {
      id: matched.tenant.id,
      name: matched.tenant.name,
      slug: matched.tenant.slug,
      keyPrefix: matched.keyPrefix,
    };

    return true;
  }
}
