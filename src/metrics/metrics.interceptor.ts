import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Response } from 'express';
import { AuthenticatedRequest } from '../common/guards/api-key.guard';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const route: string =
      (request.route as { path?: string } | undefined)?.path ?? request.url;

    const record = (status: number) =>
      this.metricsService.recordHttpRequest(
        request.method,
        route,
        status,
        request.tenant?.id,
      );

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode),
        error: (error: { status?: number }) => record(error.status ?? 500),
      }),
    );
  }
}
