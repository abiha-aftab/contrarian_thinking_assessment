import { Module } from '@nestjs/common';
import { FlagConfigCacheService } from '../cache/flag-config-cache.service';
import { FlagsController } from './flags.controller';
import { FlagsService } from './flags.service';

@Module({
  controllers: [FlagsController],
  providers: [FlagsService, FlagConfigCacheService],
})
export class FlagsModule {}
