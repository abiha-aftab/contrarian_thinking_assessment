import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { CacheModule } from './cache/cache.module';
import {
  CORRELATION_ID_HEADER,
  resolveCorrelationId,
} from './common/http/correlation-id';
import { DatabaseModule } from './database/database.module';
import { FlagsModule } from './flags/flags.module';
import { HealthModule } from './health/health.module';
import { TenantsModule } from './tenants/tenants.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', 'info'),
          redact: {
            paths: ['req.headers.authorization'],
            censor: '[REDACTED]',
          },
          genReqId: (request, response) => {
            const correlationId = resolveCorrelationId(
              request.headers[CORRELATION_ID_HEADER],
            );
            response.setHeader(CORRELATION_ID_HEADER, correlationId);
            return correlationId;
          },
        },
      }),
    }),
    DatabaseModule,
    CacheModule,
    HealthModule,
    TenantsModule,
    FlagsModule,
  ],
})
export class AppModule {}
