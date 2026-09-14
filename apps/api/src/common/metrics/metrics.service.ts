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

  // --- Sincronização (doc 18 §2) — é por estas quatro que se enxerga se o produto está vivo.
  readonly syncRunsTotal: Counter<'tenant' | 'domain' | 'status'>;
  readonly syncDuration: Histogram<'domain'>;
  readonly syncLagSeconds: Gauge<'tenant' | 'domain'>;
  readonly syncItemsUpsertedTotal: Counter<'domain'>;
  readonly queueDepth: Gauge<'queue'>;
  readonly queueDlqDepth: Gauge<'queue'>;
  readonly jobRetriesTotal: Counter<'queue'>;

  // --- Alertas (doc 18 §2 / doc 15 §8): o produto avisando o cliente sozinho.
  readonly alertEventsTotal: Counter<'tenant' | 'type'>;
  readonly alertNotificationsTotal: Counter<'tenant' | 'result'>;
  readonly alertDelivery: Histogram<'type'>;

  // --- Retenção (doc 10 §2 / E6-04): o compromisso de apagar também precisa de painel.
  readonly retentionRowsPurgedTotal: Counter<'policy'>;
  readonly retentionPendingRows: Gauge<'policy'>;
  readonly retentionLastRunSeconds: Gauge<string>;

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

    this.syncRunsTotal = new Counter({
      name: 'sync_runs_total',
      help: 'Execuções de sync por tenant, domínio e desfecho',
      labelNames: ['tenant', 'domain', 'status'],
      registers: [this.registry],
    });

    this.syncDuration = new Histogram({
      name: 'sync_duration_seconds',
      help: 'Duração das execuções de sync por domínio',
      labelNames: ['domain'],
      // Vai de segundos (dimensões) a dezenas de minutos (fatia de backfill).
      buckets: [1, 5, 15, 60, 300, 900, 1800, 3600],
      registers: [this.registry],
    });

    this.syncLagSeconds = new Gauge({
      name: 'sync_lag_seconds',
      help: "Agora menos a marca d'água do domínio — é o número que vira alerta de SLO",
      labelNames: ['tenant', 'domain'],
      registers: [this.registry],
    });

    this.syncItemsUpsertedTotal = new Counter({
      name: 'sync_items_upserted_total',
      help: 'Linhas gravadas no espelho por domínio',
      labelNames: ['domain'],
      registers: [this.registry],
    });

    this.queueDepth = new Gauge({
      name: 'queue_depth',
      help: 'Jobs aguardando ou em atraso na fila',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.queueDlqDepth = new Gauge({
      name: 'queue_dlq_depth',
      help: 'Jobs que esgotaram as tentativas (fila de veneno — runbook 22 §6)',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.jobRetriesTotal = new Counter({
      name: 'job_retries_total',
      help: 'Tentativas repetidas de jobs por fila',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.alertEventsTotal = new Counter({
      name: 'alert_events_total',
      help: 'Eventos de alerta criados por tenant e tipo (já deduplicados)',
      labelNames: ['tenant', 'type'],
      registers: [this.registry],
    });

    this.alertNotificationsTotal = new Counter({
      name: 'alert_notifications_total',
      help: 'Notificações de alerta por resultado de entrega',
      labelNames: ['tenant', 'result'],
      registers: [this.registry],
    });

    this.alertDelivery = new Histogram({
      name: 'alert_delivery_seconds',
      help: 'Tempo entre criar o evento e despachar a notificação (SLO do doc 18 §4)',
      labelNames: ['type'],
      buckets: [0.1, 0.5, 1, 3, 10, 30, 60, 300],
      registers: [this.registry],
    });

    this.retentionRowsPurgedTotal = new Counter({
      name: 'retention_rows_purged_total',
      help: 'Linhas apagadas pela purga de retenção, por política (doc 10 §2)',
      labelNames: ['policy'],
      registers: [this.registry],
    });

    // O alerta operacional mora aqui: qualquer valor > 0 por mais de um dia significa que a
    // retenção prometida ao cliente não está sendo cumprida.
    this.retentionPendingRows = new Gauge({
      name: 'retention_pending_rows',
      help: 'Linhas fora da retenção ainda presentes, por política',
      labelNames: ['policy'],
      registers: [this.registry],
    });

    this.retentionLastRunSeconds = new Gauge({
      name: 'retention_last_run_timestamp_seconds',
      help: 'Momento da última purga de retenção concluída',
      registers: [this.registry],
    });
  }

  /** Fotografia das filas, amostrada periodicamente pelo worker (doc 18 §2). */
  observeQueue(queue: string, contagens: { aguardando: number; falhos: number }): void {
    this.queueDepth.set({ queue }, contagens.aguardando);
    this.queueDlqDepth.set({ queue }, contagens.falhos);
  }

  /** Uma execução de sync concluída — o desfecho e o que ela custou. */
  observeSyncRun(params: {
    tenantId: string;
    domain: string;
    status: 'success' | 'error' | 'skipped';
    durationSeconds: number;
    items?: number;
  }): void {
    this.syncRunsTotal.inc({
      tenant: params.tenantId,
      domain: params.domain,
      status: params.status,
    });
    this.syncDuration.observe({ domain: params.domain }, params.durationSeconds);
    if (params.items) {
      this.syncItemsUpsertedTotal.inc({ domain: params.domain }, params.items);
    }
  }

  /** Atraso do domínio em segundos: agora − último sucesso (doc 18 §3). */
  setSyncLag(tenantId: string, domain: string, segundos: number): void {
    this.syncLagSeconds.set({ tenant: tenantId, domain }, segundos);
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
