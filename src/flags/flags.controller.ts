import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import {
  ApiKeyGuard,
  AuthenticatedTenant,
} from '../common/guards/api-key.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { CreateFlagDto } from './dto/create-flag.dto';
import { ListFlagsQuery } from './dto/list-flags.query';
import { UpdateFlagDto } from './dto/update-flag.dto';
import { FlagHistoryEntry, FlagsService, FlagView } from './flags.service';

function actorFor(tenant: AuthenticatedTenant): string {
  return `apikey:${tenant.keyPrefix}`;
}

@Controller('tenants/:tenantId/flags')
@UseGuards(ApiKeyGuard, RateLimitGuard)
export class FlagsController {
  constructor(private readonly flagsService: FlagsService) {}

  @Post()
  create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateFlagDto,
    @CurrentTenant() tenant: AuthenticatedTenant,
  ): Promise<FlagView> {
    return this.flagsService.createFlag(tenantId, dto, actorFor(tenant));
  }

  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Query() query: ListFlagsQuery,
  ): Promise<FlagView[]> {
    return this.flagsService.listFlags(tenantId, query);
  }

  @Put(':flagKey')
  update(
    @Param('tenantId') tenantId: string,
    @Param('flagKey') flagKey: string,
    @Body() dto: UpdateFlagDto,
    @CurrentTenant() tenant: AuthenticatedTenant,
  ): Promise<FlagView> {
    return this.flagsService.updateFlag(
      tenantId,
      flagKey,
      dto,
      actorFor(tenant),
    );
  }

  @Delete(':flagKey')
  archive(
    @Param('tenantId') tenantId: string,
    @Param('flagKey') flagKey: string,
    @CurrentTenant() tenant: AuthenticatedTenant,
  ): Promise<FlagView> {
    return this.flagsService.archiveFlag(tenantId, flagKey, actorFor(tenant));
  }

  @Get(':flagKey/history')
  history(
    @Param('tenantId') tenantId: string,
    @Param('flagKey') flagKey: string,
  ): Promise<FlagHistoryEntry[]> {
    return this.flagsService.getHistory(tenantId, flagKey);
  }
}
