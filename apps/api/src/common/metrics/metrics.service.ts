import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
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

  // --- Integração com a API SG (doc 18 §2) — o núcleo do produto vive aqui.
  readonly sgApiCallsTotal: Counter<'tenant' | 'endpoint' | 'status'>;
  readonly sgApiDuration: Histogram<'endpoint'>;
  readonly sgTokenRefreshTotal: Counter<'tenant' | 'result'>;
  readonly sgCircuitState: Gauge<'tenant'>;
  readonly sgInvalidItemsTotal: Counter<'tenant' | 'domain'>;
  readonly sgRateLimitWait: Histogram<'tenant'>;

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

    this.sgApiCallsTotal = new Counter({
      name: 'sg_api_calls_total',
      help: 'Chamadas à API SG por tenant, endpoint e status',
      labelNames: ['tenant', 'endpoint', 'status'],
      registers: [this.registry],
    });

    this.sgApiDuration = new Histogram({
      name: 'sg_api_duration_seconds',
      help: 'Duração das chamadas à API SG',
      labelNames: ['endpoint'],
      // Escala larga de propósito: endpoints com PIS/COFINS chegam a ser 3x mais lentos (doc 02 §3).
      buckets: [0.1, 0.5, 1, 3, 10, 30, 60, 120, 180],
      registers: [this.registry],
    });

    this.sgTokenRefreshTotal = new Counter({
      name: 'sg_token_refresh_total',
      help: 'Renovações de token da API SG por resultado',
      labelNames: ['tenant', 'result'],
      registers: [this.registry],
    });

    this.sgCircuitState = new Gauge({
      name: 'sg_circuit_state',
      help: 'Estado do disjuntor por tenant (0 fechado, 1 meio-aberto, 2 aberto)',
      labelNames: ['tenant'],
      registers: [this.registry],
    });

    this.sgInvalidItemsTotal = new Counter({
      name: 'sg_invalid_items_total',
      help: 'Itens que caíram em quarentena por não bater com o schema (drift de contrato)',
      labelNames: ['tenant', 'domain'],
      registers: [this.registry],
    });

    this.sgRateLimitWait = new Histogram({
      name: 'sg_rate_limit_wait_seconds',
      help: 'Tempo de espera imposto pelo self-rate-limit por tenant',
      labelNames: ['tenant'],
      buckets: [0.05, 0.25, 1, 3, 10, 30],
      registers: [this.registry],
    });
  }

  /** Uma chamada à API SG concluída (com sucesso ou não). */
  observeSgCall(params: {
    tenantId: string;
    endpoint: string;
    status: number | string;
    durationSeconds: number;
    esperaSegundos?: number;
  }): void {
    this.sgApiCallsTotal.inc({
      tenant: params.tenantId,
      endpoint: params.endpoint,
      status: String(params.status),
    });
    this.sgApiDuration.observe({ endpoint: params.endpoint }, params.durationSeconds);
    if (params.esperaSegundos && params.esperaSegundos > 0) {
      this.sgRateLimitWait.observe({ tenant: params.tenantId }, params.esperaSegundos);
    }
  }

  /** 0 fechado · 1 meio-aberto · 2 aberto. */
  setSgCircuitState(tenantId: string, valor: 0 | 1 | 2): void {
    this.sgCircuitState.set({ tenant: tenantId }, valor);
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
