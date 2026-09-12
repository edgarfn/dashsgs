import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { type Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * Mede toda requisição HTTP (doc 18 §2). Usa o PADRÃO da rota (`/api/v1/kpi/:id`), nunca a URL
 * concreta — do contrário cada id viraria uma série nova no Prometheus.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    const record = () => {
      const route = request.route?.path ?? this.fallbackRoute(request);
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      this.metrics.observeHttp(route, request.method, response.statusCode, seconds);
    };

    return next.handle().pipe(tap({ next: record, error: record }));
  }

  /** Rotas não resolvidas (404) entram como `unmatched` para não explodir a cardinalidade. */
  private fallbackRoute(request: Request): string {
    const path = (request.originalUrl ?? request.url ?? '').split('?')[0] ?? '';
    return ['/healthz', '/readyz', '/metrics'].includes(path) ? path : 'unmatched';
  }
}
