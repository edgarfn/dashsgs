import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { type SyncDomain } from '@dashsgs/shared';
import { Worker, type Job } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { AppConfigService } from '../../../config';
import { BackfillService } from '../backfill.service';
import { SyncService } from '../sync.service';
import {
  FILA_BACKFILL,
  FILA_SYNC,
  PREFIXO_FILA,
  SyncQueueService,
  type JobBackfill,
  type JobSync,
} from './sync-queue.service';
import { SyncSchedulerService } from './sync-scheduler.service';

/** Backoff do doc 14 §5: 1 min → 5 → 15 → 60. Depois disso o job vai para a DLQ com alerta. */
const ESPERAS_MS = [60_000, 300_000, 900_000, 3_600_000];

/** Intervalo entre passos de backfill: dá vez ao tempo real entre uma fatia e outra. */
const INTERVALO_BACKFILL_MS = 5_000;

/** Amostragem da profundidade das filas: frequente o bastante para alertar, barata o bastante. */
const INTERVALO_METRICAS_MS = 15_000;

/**
 * Consumidor das filas (E5-01) — só existe no processo de worker.
 *
 * Cada job é um escopo pequeno: um domínio de um tenant (de uma filial, quando houver recorte).
 * Falha isolada não contamina os demais (doc 14 §1): o job erra, entra no backoff e o resto da
 * fila segue. O `SyncService` é quem garante lock, marca d'água e histórico.
 */
@Injectable()
export class SyncWorker implements OnModuleInit, OnApplicationShutdown {
  private conexao?: Redis;
  private workerSync?: Worker<JobSync>;
  private workerBackfill?: Worker<JobBackfill>;
  private amostragem?: NodeJS.Timeout;

  constructor(
    private readonly config: AppConfigService,
    private readonly sync: SyncService,
    private readonly backfill: BackfillService,
    private readonly scheduler: SyncSchedulerService,
    private readonly filas: SyncQueueService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SyncWorker.name);
  }

  async onModuleInit(): Promise<void> {
    this.conexao = new IORedis(this.config.redisUrl, { maxRetriesPerRequest: null });

    const comum = {
      connection: this.conexao,
      prefix: PREFIXO_FILA,
      settings: {
        backoffStrategy: (tentativas: number) =>
          ESPERAS_MS[Math.min(tentativas - 1, ESPERAS_MS.length - 1)] ?? 3_600_000,
      },
    };

    this.workerSync = new Worker<JobSync>(FILA_SYNC, async (job) => this.processarSync(job), {
      ...comum,
      concurrency: this.config.sync.concurrency,
    });

    // Backfill com concorrência 1 por processo: ele é a carga que mais pesa no ERP da loja, e
    // "nunca degradar o ERP do cliente" (doc 14 §1) vale mais que terminar a carga mais cedo.
    this.workerBackfill = new Worker<JobBackfill>(
      FILA_BACKFILL,
      async (job) => this.processarBackfill(job),
      { ...comum, concurrency: 1 },
    );

    for (const worker of [this.workerSync, this.workerBackfill]) {
      worker.on('failed', (job, erro) => {
        this.metrics.jobRetriesTotal.inc({ queue: worker.name });
        this.logger.error(
          {
            event: 'sync_job_failed',
            fila: worker.name,
            job: job?.id,
            tentativa: job?.attemptsMade,
            erro: erro.message,
          },
          'sync_job_failed',
        );
      });
    }

    // Profundidade das filas vira alerta operacional (doc 18 §4): fila que cresce sem parar é
    // sinal de ERP fora do ar ou de worker parado, e os dois precisam acordar alguém.
    this.amostragem = setInterval(() => {
      void this.amostrarFilas();
    }, INTERVALO_METRICAS_MS);
    this.amostragem.unref?.();

    if (this.config.sync.schedulerEnabled) {
      await this.scheduler.registrarCadencias();
    }

    this.logger.info(
      {
        event: 'sync_worker_pronto',
        concorrencia: this.config.sync.concurrency,
        scheduler: this.config.sync.schedulerEnabled,
      },
      'sync_worker_pronto',
    );
  }

  private async processarSync(job: Job<JobSync>): Promise<unknown> {
    const dados = job.data;

    if (dados.tipo === 'tick') {
      const enfileirados = await this.scheduler.processarTick(dados.domain);
      return { enfileirados };
    }

    if (!dados.tenantId) throw new Error('job de domínio sem tenant');

    const desfecho = await this.sync.executar({
      tenantId: dados.tenantId,
      domain: dados.domain as SyncDomain,
      filialErpId: dados.filialErpId,
      data: dados.data,
      trigger: 'scheduler',
    });

    // Erro do domínio vira falha do job **de propósito**: é o que aciona o backoff do doc 14 §5
    // e, depois das tentativas, a DLQ que o runbook 22 §6 manda inspecionar.
    if (desfecho.status === 'error') throw new Error(desfecho.erro ?? 'falha na sincronização');

    return desfecho;
  }

  private async processarBackfill(job: Job<JobBackfill>): Promise<unknown> {
    const { tenantId } = job.data;
    const passo = await this.backfill.executarPasso(tenantId);

    if (!passo.concluido) {
      await this.filas.enfileirarBackfill(tenantId, INTERVALO_BACKFILL_MS);
    }

    return passo;
  }

  private async amostrarFilas(): Promise<void> {
    try {
      for (const fila of [this.filas.sync, this.filas.backfill]) {
        const contagens = await fila.getJobCounts('wait', 'delayed', 'failed');
        this.metrics.observeQueue(fila.name, {
          aguardando: (contagens.wait ?? 0) + (contagens.delayed ?? 0),
          falhos: contagens.failed ?? 0,
        });
      }
    } catch {
      // Redis fora do ar já é reportado pelo readyz; a amostragem não precisa gritar de novo.
    }
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.amostragem);
    // `close()` espera o job corrente terminar: derrubar no meio deixaria marca d'água em
    // `running` e lock ocupado até o TTL.
    await this.workerSync?.close();
    await this.workerBackfill?.close();
    this.conexao?.disconnect();
  }
}
