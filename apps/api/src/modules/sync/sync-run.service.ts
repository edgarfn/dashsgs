import { Injectable } from '@nestjs/common';
import { type SyncDomain, type SyncTrigger } from '@dashsgs/shared';
import { PinoLogger } from 'nestjs-pino';
import { MetricsService } from '../../common/metrics/metrics.service';
import { TenantDatabase } from '../../common/tenant';

export interface ResumoExecucao {
  pages?: number;
  items?: number;
  apiCalls?: number;
  invalid?: number;
}

export interface RegistroExecucao extends ResumoExecucao {
  id: bigint;
  tenantId: string;
  domain: SyncDomain;
  filialErpId: number | null;
  trigger: SyncTrigger;
  startedAt: Date;
  finishedAt: Date | null;
  status: 'running' | 'success' | 'error' | 'skipped';
  durationMs: number | null;
  error: string | null;
}

/**
 * Histórico de execuções de sync (doc 05 §2) — o que o painel de sync-status mostra e o que o
 * plantão lê às 3 da manhã.
 *
 * Grava sempre, inclusive o `skipped` (lock ocupado) e o `error`: uma execução que não aconteceu
 * é informação, não silêncio. É daqui que sai a resposta para "desde quando isso não roda?".
 */
@Injectable()
export class SyncRunService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SyncRunService.name);
  }

  async iniciar(params: {
    tenantId: string;
    domain: SyncDomain;
    filialErpId?: number | null;
    trigger: SyncTrigger;
  }): Promise<bigint> {
    const registro = await this.tenantDb.run(params.tenantId, (tx) =>
      tx.syncJobRun.create({
        data: {
          tenantId: params.tenantId,
          domain: params.domain,
          filialErpId: params.filialErpId ?? null,
          trigger: params.trigger,
          status: 'running',
        },
        select: { id: true },
      }),
    );
    return registro.id;
  }

  async concluir(params: {
    id: bigint;
    tenantId: string;
    domain: SyncDomain;
    status: 'success' | 'error' | 'skipped';
    resumo?: ResumoExecucao;
    erro?: string;
  }): Promise<void> {
    const agora = new Date();

    const atualizado = await this.tenantDb.run(params.tenantId, async (tx) => {
      const anterior = await tx.syncJobRun.findUnique({
        where: { id: params.id },
        select: { startedAt: true },
      });
      const durationMs = anterior ? agora.getTime() - anterior.startedAt.getTime() : null;

      await tx.syncJobRun.update({
        where: { id: params.id },
        data: {
          status: params.status,
          finishedAt: agora,
          durationMs,
          pages: params.resumo?.pages ?? 0,
          items: params.resumo?.items ?? 0,
          apiCalls: params.resumo?.apiCalls ?? 0,
          invalid: params.resumo?.invalid ?? 0,
          error: params.erro?.slice(0, 300) ?? null,
        },
      });

      return durationMs;
    });

    this.metrics.observeSyncRun({
      tenantId: params.tenantId,
      domain: params.domain,
      status: params.status,
      durationSeconds: (atualizado ?? 0) / 1_000,
      items: params.resumo?.items,
    });

    const evento = {
      event: 'sync_run_finished',
      tenant_id: params.tenantId,
      dominio: params.domain,
      status: params.status,
      duracao_ms: atualizado,
      ...params.resumo,
    };

    if (params.status === 'error') {
      this.logger.error({ ...evento, erro: params.erro }, 'sync_run_finished');
    } else {
      this.logger.info(evento, 'sync_run_finished');
    }
  }

  /** Últimas execuções do tenant — alimenta o painel (E5-12). */
  async ultimas(tenantId: string, limite = 20): Promise<RegistroExecucao[]> {
    const linhas = await this.tenantDb.run(tenantId, (tx) =>
      tx.syncJobRun.findMany({ orderBy: { startedAt: 'desc' }, take: limite }),
    );

    return linhas.map((linha) => ({
      ...linha,
      domain: linha.domain as SyncDomain,
      trigger: linha.trigger as SyncTrigger,
      status: linha.status as RegistroExecucao['status'],
    }));
  }

  /**
   * Contabiliza uma chamada à API SG (doc 05 §2) — **sem payload**, só métrica.
   *
   * O registro é por página coletada, não por requisição HTTP: quem precisa do detalhe fino usa
   * `sg_api_calls_total` no Prometheus. Aqui o objetivo é responder, meses depois, "quanto este
   * tenant custou de chamada" sem depender da retenção do Prometheus.
   */
  async registrarChamadas(
    tenantId: string,
    chamadas: Array<{
      endpoint: string;
      method?: string;
      httpStatus?: number;
      durationMs: number;
      items?: number;
    }>,
  ): Promise<void> {
    if (chamadas.length === 0) return;

    await this.tenantDb.run(tenantId, (tx) =>
      tx.syncApiCallLog.createMany({
        data: chamadas.map((chamada) => ({
          tenantId,
          endpoint: chamada.endpoint.slice(0, 120),
          method: chamada.method ?? 'GET',
          httpStatus: chamada.httpStatus ?? 200,
          durationMs: Math.round(chamada.durationMs),
          items: chamada.items ?? 0,
        })),
      }),
    );
  }

  /** Retenção de 30 dias da contabilidade de chamadas (doc 05 §2). */
  async purgarChamadasAntigas(tenantId: string, dias = 30): Promise<number> {
    const limite = new Date(Date.now() - dias * 86_400_000);
    const { count } = await this.tenantDb.run(tenantId, (tx) =>
      tx.syncApiCallLog.deleteMany({ where: { calledAt: { lt: limite } } }),
    );
    return count;
  }
}
