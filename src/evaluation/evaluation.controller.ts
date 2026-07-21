import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import {
  ApiKeyGuard,
  AuthenticatedTenant,
} from '../common/guards/api-key.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { EvaluateBulkDto, EvaluateDto } from './dto/evaluate.dto';
import {
  BulkEvaluation,
  EvaluationService,
  SingleEvaluation,
} from './evaluation.service';

@Controller('evaluate')
@UseGuards(ApiKeyGuard, RateLimitGuard)
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Post()
  @HttpCode(200)
  evaluate(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Body() dto: EvaluateDto,
  ): Promise<SingleEvaluation> {
    return this.evaluationService.evaluateOne(tenant, dto);
  }

  @Post('bulk')
  @HttpCode(200)
  evaluateBulk(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Body() dto: EvaluateBulkDto,
  ): Promise<BulkEvaluation> {
    return this.evaluationService.evaluateBulk(tenant, dto);
  }
}
