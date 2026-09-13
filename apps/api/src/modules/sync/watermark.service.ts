import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type SyncDomain } from '@dashsgs/shared';
import { TenantDatabase } from '../../common/tenant';
import { type PrismaTransaction } from '../../common/prisma/prisma.service';

/** `0` é o "sem recorte por filial" da PK (doc 05 §2) — evita índice parcial e NULL na chave. */
export const SEM_FILIAL = 0;

export interface Watermark {
  domain: string;
  filialErpId: number;
  /** Último dia fechado com sucesso (fatos por data). */
  watermarkDate: string | null;
  /** Instante da última varredura bem-sucedida (cadastros por alteração). */
  watermarkTs: Date | null;
  cursor: Record<string, unknown> | null;
  status: 'idle' | 'running' | 'error';
  lastSuccessAt: Date | null;
  lastError: string | null;
}

/**
 * Marcas d'água: até onde cada domínio já foi sincronizado (doc 14 §1).
 *
 * Regra única e inegociável: **a marca só avança em sucesso**. Se a página 7 de 10 falhar, o
 * watermark continua onde estava e a próxima execução refaz o trecho inteiro — repetir é barato
 * (todo write é idempotente), perder um dia de vendas não é.
 */
@Injectable()
export class WatermarkService {
  constructor(private readonly tenantDb: TenantDatabase) {}

  async listar(tenantId: string): Promise<Watermark[]> {
    const linhas = await this.tenantDb.run(tenantId, (tx) =>
      tx.syncWatermark.findMany({ orderBy: [{ domain: 'asc' }, { filialErpId: 'asc' }] }),
    );
    return linhas.map((linha) => this.paraWatermark(linha));
  }

  async obter(
    tenantId: string,
    domain: SyncDomain,
    filialErpId = SEM_FILIAL,
  ): Promise<Watermark | null> {
    const linha = await this.tenantDb.run(tenantId, (tx) =>
      tx.syncWatermark.findUnique({
        where: { tenantId_domain_filialErpId: { tenantId, domain, filialErpId } },
      }),
    );
    return linha ? this.paraWatermark(linha) : null;
  }

  /** Marca o início de uma execução. Roda na transação do chamador quando houver. */
  async marcarRodando(
    tenantId: string,
    domain: SyncDomain,
    filialErpId = SEM_FILIAL,
  ): Promise<void> {
    await this.tenantDb.run(tenantId, (tx) =>
      this.upsert(tx, tenantId, domain, filialErpId, { status: 'running' }),
    );
  }

  /**
   * Conclui com sucesso. `watermarkDate` só é aceito para frente: um backfill que processa
   * fatias antigas não pode empurrar a marca para trás e fazer o incremental reprocessar o mês.
   */
  async concluir(
    tenantId: string,
    domain: SyncDomain,
    params: {
      filialErpId?: number;
      watermarkDate?: string | null;
      watermarkTs?: Date | null;
      cursor?: Record<string, unknown> | null;
    } = {},
  ): Promise<void> {
    const filialErpId = params.filialErpId ?? SEM_FILIAL;

    await this.tenantDb.run(tenantId, async (tx) => {
      const atual = await tx.syncWatermark.findUnique({
        where: { tenantId_domain_filialErpId: { tenantId, domain, filialErpId } },
      });

      const dataNova = params.watermarkDate ? new Date(`${params.watermarkDate}T00:00:00Z`) : null;
      const dataFinal =
        dataNova && (!atual?.watermarkDate || dataNova > atual.watermarkDate)
          ? dataNova
          : (atual?.watermarkDate ?? null);

      await this.upsert(tx, tenantId, domain, filialErpId, {
        status: 'idle',
        watermarkDate: dataFinal,
        watermarkTs: params.watermarkTs ?? atual?.watermarkTs ?? null,
        cursor: params.cursor === undefined ? undefined : params.cursor,
        lastSuccessAt: new Date(),
        lastError: null,
      });
    });
  }

  /** Registra a falha sem mexer na marca — o próximo ciclo refaz o mesmo trecho. */
  async falhar(
    tenantId: string,
    domain: SyncDomain,
    erro: string,
    filialErpId = SEM_FILIAL,
  ): Promise<void> {
    await this.tenantDb.run(tenantId, (tx) =>
      this.upsert(tx, tenantId, domain, filialErpId, {
        status: 'error',
        lastError: erro.slice(0, 300),
      }),
    );
  }

  private async upsert(
    tx: PrismaTransaction,
    tenantId: string,
    domain: string,
    filialErpId: number,
    dados: {
      status?: 'idle' | 'running' | 'error';
      watermarkDate?: Date | null;
      watermarkTs?: Date | null;
      cursor?: Record<string, unknown> | null;
      lastSuccessAt?: Date;
      lastError?: string | null;
    },
  ): Promise<void> {
    // JSON nulo no Prisma pede sentinela: `null` cru não distingue "apague o cursor" de
    // "não mexa nele".
    const cursor =
      dados.cursor === undefined
        ? undefined
        : dados.cursor === null
          ? Prisma.DbNull
          : (dados.cursor as Prisma.InputJsonValue);

    const valores = { ...dados, cursor };

    await tx.syncWatermark.upsert({
      where: { tenantId_domain_filialErpId: { tenantId, domain, filialErpId } },
      update: valores,
      create: { tenantId, domain, filialErpId, ...valores },
    });
  }

  private paraWatermark(linha: {
    domain: string;
    filialErpId: number;
    watermarkDate: Date | null;
    watermarkTs: Date | null;
    cursor: unknown;
    status: string;
    lastSuccessAt: Date | null;
    lastError: string | null;
  }): Watermark {
    return {
      domain: linha.domain,
      filialErpId: linha.filialErpId,
      watermarkDate: linha.watermarkDate ? linha.watermarkDate.toISOString().slice(0, 10) : null,
      watermarkTs: linha.watermarkTs,
      cursor: (linha.cursor as Record<string, unknown> | null) ?? null,
      status: linha.status as Watermark['status'],
      lastSuccessAt: linha.lastSuccessAt,
      lastError: linha.lastError,
    };
  }
}
