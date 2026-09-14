import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type SyncDomain } from '@dashsgs/shared';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';

/** Nome das filas. Duas, e não uma, para que o backfill nunca atrase o tempo real. */
export const FILA_SYNC = 'sync';
export const FILA_BACKFILL = 'sync-backfill';
/** Prefixo das chaves no Redis — mantém as filas longe do cache e das sessões. */
export const PREFIXO_FILA = 'dashsgs';

export interface JobSync {
  /**
   * `alertas` compartilha a fila do sync por conveniência operacional (um worker, uma fila,
   * um painel), mas **não** passa pelo SyncService: alerta não depende de conexão com o ERP —
   * e o alerta mais importante é justamente "a integração parou".
   */
  tipo: 'dominio' | 'tick' | 'alertas';
  tenantId?: string;
  domain: SyncDomain;
  filialErpId?: number;
  data?: string;
}

export interface JobBackfill {
  tenantId: string;
}

/**
 * Produtor das filas de sincronização (E5-01).
 *
 * A API só **enfileira** — quem executa é o processo de worker. Essa separação é o que permite
 * reiniciar a API no meio de um backfill de 26 meses sem perder o progresso, e o que impede que
 * uma carga histórica pesada roube CPU do request do dashboard.
 */
@Injectable()
export class SyncQueueService implements OnModuleDestroy {
  private readonly conexao: Redis;
  readonly sync: Queue<JobSync>;
  readonly backfill: Queue<JobBackfill>;

  constructor(
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SyncQueueService.name);

    // BullMQ exige `maxRetriesPerRequest: null`: ele gerencia a própria política de retentativa,
    // e o padrão do ioredis derrubaria comandos bloqueantes de fila.
    this.conexao = new IORedis(this.config.redisUrl, { maxRetriesPerRequest: null });

    const opcoes = {
      connection: this.conexao,
      prefix: PREFIXO_FILA,
      defaultJobOptions: {
        // Backoff do doc 14 §5: 1 min → 5 → 15 → 60, e depois o domínio pausa com alerta.
        attempts: 4,
        backoff: { type: 'custom' as const },
        removeOnComplete: { age: 3_600, count: 500 },
        removeOnFail: { age: 86_400 * 3 },
      },
    };

    this.sync = new Queue<JobSync>(FILA_SYNC, opcoes);
    this.backfill = new Queue<JobBackfill>(FILA_BACKFILL, opcoes);
  }

  /**
   * Enfileira um domínio para um tenant. O id do job é determinístico: se a cadência anterior
   * ainda não foi processada, a nova não vira uma segunda cópia na fila.
   */
  async enfileirar(
    job: JobSync,
    opcoes: { prioridade?: number; delayMs?: number } = {},
  ): Promise<void> {
    // O BullMQ recusa ':' em id de job (é o separador das chaves dele no Redis).
    const id = [job.tenantId ?? 'todos', job.domain, job.filialErpId ?? 'geral', job.data ?? 'auto']
      .join('--')
      .slice(0, 120);

    await this.sync.add(job.domain, job, {
      jobId: id,
      priority: opcoes.prioridade,
      delay: opcoes.delayMs,
    });
  }

  /** Um passo de backfill. O próprio worker reenfileira o passo seguinte até concluir. */
  async enfileirarBackfill(tenantId: string, delayMs = 0): Promise<void> {
    await this.backfill.add(
      'backfill',
      { tenantId },
      { jobId: `backfill--${tenantId}--${Date.now()}`, delay: delayMs },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.sync.close();
    await this.backfill.close();
    this.conexao.disconnect();
  }
}
