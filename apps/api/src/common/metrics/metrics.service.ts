import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { AppConfigService } from '../../config';

/**
 * Registro de métricas Prometheus (doc 18 §2).
 *
 * Cardinalidade é orçamento: rotulamos rota/método/status — nunca id de recurso, nunca produto.
 * `tenant` entra apenas nas métricas de integração/sync, onde o número de séries é conhecido.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequestDuration: Histogram<'route' | 'method' | 'status'>;
  readonly httpRequestsTotal: Counter<'route' | 'method' | 'status'>;
  readonly httpErrorsTotal: Counter<'route' | 'method' | 'status'>;

  constructor(private readonly config: AppConfigService) {
    this.registry.setDefaultLabels({ service: 'dashsgs-api', env: this.config.nodeEnv });
    collectDefaultMetrics({ register: this.registry, prefix: 'dashsgs_' });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duração das requisições HTTP da API interna',
      labelNames: ['route', 'method', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total de requisições HTTP da API interna',
      labelNames: ['route', 'method', 'status'],
      registers: [this.registry],
    });

    this.httpErrorsTotal = new Counter({
      name: 'http_errors_total',
      help: 'Total de respostas 5xx da API interna',
      labelNames: ['route', 'method', 'status'],
      registers: [this.registry],
    });
  }

  observeHttp(route: string, method: string, status: number, durationSeconds: number): void {
    const labels = { route, method, status: String(status) };
    this.httpRequestDuration.observe(labels, durationSeconds);
    this.httpRequestsTotal.inc(labels);
    if (status >= 500) this.httpErrorsTotal.inc(labels);
  }

  async scrape(): Promise<string> {
    return this.registry.metrics();
  }
}
