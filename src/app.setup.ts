import { INestApplication, ValidationPipe } from '@nestjs/common';
import { httpMetricsMiddleware } from './metrics/http-metrics.middleware';
import { MetricsService } from './metrics/metrics.service';

/**
 * HTTP wiring shared by the server entry point and the integration suite, so
 * the tests exercise the same prefix, validation and metrics as production.
 */
export function configureApp(app: INestApplication): void {
  app.use(httpMetricsMiddleware(app.get(MetricsService)));
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/live', 'health/ready', 'metrics'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
}
