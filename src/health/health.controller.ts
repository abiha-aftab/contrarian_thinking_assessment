import { Controller, Get } from '@nestjs/common';
import { HealthService, ReadinessResult } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  readiness(): Promise<ReadinessResult> {
    return this.healthService.readiness();
  }
}
