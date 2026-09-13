import { Injectable } from '@nestjs/common';
import { SYNC_DOMAIN_INFO, type SyncDomain, type SyncTrigger, isSyncDomain } from '@dashsgs/shared';
import { PinoLogger } from 'nestjs-pino';
import { AppException } from '../../common/errors/app.exception';
import { MetricsService } from '../../common/metrics/metrics.service';
import { TenantDatabase } from '../../common/tenant';
import { SgError } from '../../integration/sg';
import { ErpConnectionService } from '../erp-connection/erp-connection.service';
import { DimensoesSync } from './domains/dimensoes.sync';
import { ProdutosSync } from './domains/produtos.sync';
import { ResumoFilialSync } from './domains/resumo-filial.sync';
import { VendasDiaSync } from './domains/vendas-dia.sync';
import { VendasHojeSync } from './domains/vendas-hoje.sync';
import { SyncLockService } from './sync-lock.service';
import { SyncRunService } from './sync-run.service';
import { type ContextoSync, type JobDeSync, type ResultadoSync, diaEm } from './sync.types';
import { SEM_FILIAL, WatermarkService } from './watermark.service';

export interface PedidoSync {
  tenantId: string;
  domain: SyncDomain;
  filialErpId?: number;
  /** Dia alvo (`YYYY-MM-DD`) — usado por backfill e re-sync manual. */
  data?: string;
  /** Janela explícita para domínios de período (resumo diário) — usada pelo backfill. */
  periodo?: { inicio: string; fim: string };
  trigger?: SyncTrigger;
}

export interface DesfechoSync {
  status: 'success' | 'error' | 'skipped';
  resultado?: ResultadoSync;
  erro?: string;
}

/** TTL do lock: generoso o bastante para uma fatia pesada, curto o bastante para destravar sozinho. */
const TTL_LOCK_SEGUNDOS = 900;

/**
 * Orquestrador de sincronização (E5-01).
 *
 * Toda execução — cadência, backfill ou clique no painel — passa por aqui, e o roteiro é sempre
 * o mesmo: verifica se o tenant pode sincronizar, pega o lock do escopo, registra a execução,
 * roda o domínio, move a marca d'água **só em sucesso** e fecha o histórico.
 *
 * Centralizar isso não é elegância: é a garantia de que nenhum domínio novo esqueça o lock, o
 * watermark ou o registro — os três defeitos que transformam sync em mistério de plantão.
 */
@Injectable()
export class SyncService {
  private readonly jobs: Record<SyncDomain, JobDeSync | null>;

  constructor(
    private readonly conexoes: ErpConnectionService,
    private readonly tenantDb: TenantDatabase,
    private readonly locks: SyncLockService,
    private readonly runs: SyncRunService,
    private readonly watermarks: WatermarkService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
    dimensoes: DimensoesSync,
    produtos: ProdutosSync,
    vendasHoje: VendasHojeSync,
    vendasDia: VendasDiaSync,
    resumoFilial: ResumoFilialSync,
  ) {
    this.logger.setContext(SyncService.name);
    this.jobs = {
      // `health` mexe na conexão, não no espelho (ver `executarHealth`); `backfill` tem serviço
      // próprio, porque ele orquestra outros domínios em vez de buscar dado.
      health: null,
      backfill: null,
      dimensoes,
      produtos,
      vendas_hoje: vendasHoje,
      vendas_dia: vendasDia,
      resumo_filial: resumoFilial,
    };
  }

  async executar(pedido: PedidoSync): Promise<DesfechoSync> {
    const trigger = pedido.trigger ?? 'scheduler';
    const { domain, tenantId } = pedido;

    if (!isSyncDomain(domain)) {
      throw new AppException('VALIDATION_ERROR', { message: `Domínio desconhecido: ${domain}` });
    }

    const tenant = await this.tenantDb.run(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { status: true, timezone: true, deletedAt: true },
      }),
    );

    // Tenant suspenso não fala com o ERP do cliente (doc 08 §5): suspensão que continua puxando
    // dado não é suspensão.
    if (!tenant || tenant.deletedAt || tenant.status !== 'active') {
      return { status: 'skipped', resultado: { observacao: 'tenant inativo' } };
    }

    if (!(await this.conexoes.prontaParaSync(tenantId))) {
      return { status: 'skipped', resultado: { observacao: 'conexão com o ERP indisponível' } };
    }

    const escopo = this.escopo(domain, pedido.filialErpId);
    const runId = await this.runs.iniciar({
      tenantId,
      domain,
      filialErpId: pedido.filialErpId ?? null,
      trigger,
    });

    try {
      const resultado = await this.locks.comLock(tenantId, escopo, TTL_LOCK_SEGUNDOS, async () =>
        this.executarComContexto({ ...pedido, trigger }, tenant.timezone),
      );

      if (resultado === null) {
        // Outro worker está no mesmo escopo: não é erro, é a concorrência funcionando.
        await this.runs.concluir({ id: runId, tenantId, domain, status: 'skipped' });
        return { status: 'skipped', resultado: { observacao: 'escopo já em execução' } };
      }

      await this.runs.concluir({
        id: runId,
        tenantId,
        domain,
        status: 'success',
        resumo: resultado,
      });

      return { status: 'success', resultado };
    } catch (erro) {
      const motivo = this.motivo(erro);

      await this.watermarks.falhar(tenantId, domain, motivo, pedido.filialErpId ?? SEM_FILIAL);
      await this.runs.concluir({
        id: runId,
        tenantId,
        domain,
        status: 'error',
        erro: motivo,
      });

      return { status: 'error', erro: motivo };
    }
  }

  /** Executa o domínio dentro do contexto de tenant, com a marca d'água em `running`. */
  private async executarComContexto(
    pedido: PedidoSync & { trigger: SyncTrigger },
    timezone: string,
  ): Promise<ResultadoSync> {
    const { tenantId, domain } = pedido;
    const filialErpId = pedido.filialErpId ?? SEM_FILIAL;

    await this.watermarks.marcarRodando(tenantId, domain, filialErpId);

    const resultado =
      domain === 'health'
        ? await this.executarHealth(tenantId)
        : await this.executarDominio(pedido, timezone);

    await this.watermarks.concluir(tenantId, domain, {
      filialErpId,
      watermarkDate: resultado.watermarkDate ?? null,
      watermarkTs: resultado.watermarkTs ?? null,
      cursor: resultado.cursor,
    });

    this.metrics.setSyncLag(tenantId, domain, 0);
    return resultado;
  }

  private async executarDominio(
    pedido: PedidoSync & { trigger: SyncTrigger },
    timezone: string,
  ): Promise<ResultadoSync> {
    const job = this.jobs[pedido.domain];
    if (!job) throw new AppException('INTERNAL', { message: 'domínio sem job' });

    const sg = await this.conexoes.callContext(pedido.tenantId);

    const contexto: ContextoSync = {
      tenantId: pedido.tenantId,
      sg,
      filialErpId: pedido.filialErpId,
      // O dia é o do **fuso do tenant**: às 22h de Manaus ainda é o dia anterior em São Paulo,
      // e sincronizar o dia errado é o tipo de bug que só aparece na loja do cliente.
      data: pedido.data ?? diaEm(new Date(), timezone),
      periodo: pedido.periodo,
      trigger: pedido.trigger,
    };

    return job.executar(contexto);
  }

  private async executarHealth(tenantId: string): Promise<ResultadoSync> {
    const saude = await this.conexoes.verificarSaude(tenantId);

    if (saude.status === 'error') {
      throw new AppException('ERP_UNREACHABLE', {
        message: saude.motivo ?? 'ERP indisponível',
      });
    }

    return {
      apiCalls: 2,
      watermarkTs: new Date(),
      observacao: `versão ${saude.versao ?? '?'} · ${saude.rotas} rotas`,
    };
  }

  /** Escopo do lock: por filial quando o domínio tem recorte, senão o domínio inteiro. */
  private escopo(domain: SyncDomain, filialErpId?: number): string {
    return SYNC_DOMAIN_INFO[domain].porFilial && filialErpId !== undefined
      ? `${domain}:${filialErpId}`
      : domain;
  }

  private motivo(erro: unknown): string {
    if (erro instanceof SgError) {
      return `${erro.falha}${erro.detalhe.mensagemOrigem ? `: ${erro.detalhe.mensagemOrigem}` : ''}`;
    }
    if (erro instanceof AppException) return `${erro.code}: ${erro.message}`;
    return erro instanceof Error ? erro.message : 'falha inesperada';
  }
}
