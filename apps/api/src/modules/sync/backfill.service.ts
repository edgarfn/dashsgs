import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { JANELA_MAXIMA_DIAS } from '../../integration/sg';
import { AppException } from '../../common/errors/app.exception';
import { TenantDatabase } from '../../common/tenant';
import { fatiar } from './domains/resumo-filial.sync';
import { SyncService } from './sync.service';
import { diaEm, diferencaEmDias, somarDias } from './sync.types';
import { SEM_FILIAL, WatermarkService } from './watermark.service';

/**
 * Carga histórica resumível (doc 14 §3 / E5-07).
 *
 * Três decisões moldam este serviço:
 *
 * 1. **De trás para frente.** O dia mais recente entra primeiro; o dashboard fica utilizável em
 *    minutos, enquanto 26 meses de histórico continuam entrando por baixo.
 * 2. **Em fatias, com estado no banco.** Cada execução processa um punhado de dias e grava onde
 *    parou. Deploy, reinício de worker ou ERP fora do ar não recomeçam nada do zero.
 * 3. **Nunca degradar o ERP da loja** (doc 14 §1). O backfill tem prioridade mais baixa no
 *    self-rate-limit e respeita a janela noturna configurada no tenant.
 */

/** Fatias processadas por execução: o suficiente para progredir, pouco o bastante para dar a vez. */
const DIAS_POR_EXECUCAO = 5;
/** Teto de profundidade — 26 meses é o padrão contratado (doc 14 §3). */
const MAX_DIAS = 800;

export interface PlanoBackfill {
  inicio: string;
  fim: string;
  filiais: number[];
  /** Fase atual: primeiro os resumos (que trazem as marcas de fechamento), depois as vendas. */
  etapa: 'resumos' | 'vendas' | 'concluido';
  /** Próximo dia a processar, caminhando para trás. */
  diaAtual: string;
  totalDias: number;
  diasFeitos: number;
  iniciadoEm: string;
}

export interface ProgressoBackfill {
  ativo: boolean;
  plano: PlanoBackfill | null;
  percentual: number;
}

@Injectable()
export class BackfillService {
  constructor(
    private readonly sync: SyncService,
    private readonly watermarks: WatermarkService,
    private readonly tenantDb: TenantDatabase,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BackfillService.name);
  }

  /** Monta o plano e o grava. Quem executa é o worker, fatia a fatia. */
  async iniciar(
    tenantId: string,
    opcoes: { dias: number; filiais?: number[] },
  ): Promise<PlanoBackfill> {
    if (opcoes.dias < 1 || opcoes.dias > MAX_DIAS) {
      throw new AppException('VALIDATION_ERROR', {
        message: `Profundidade precisa estar entre 1 e ${MAX_DIAS} dias.`,
        details: [{ path: 'dias', rule: 'range' }],
      });
    }

    const timezone = await this.timezoneDoTenant(tenantId);
    const fim = somarDias(diaEm(new Date(), timezone), -1);
    const inicio = somarDias(fim, -(opcoes.dias - 1));

    const filiais = opcoes.filiais?.length ? opcoes.filiais : await this.filiais(tenantId);
    if (filiais.length === 0) {
      throw new AppException('VALIDATION_ERROR', {
        message: 'Sincronize os cadastros antes: nenhuma filial conhecida ainda.',
      });
    }

    const plano: PlanoBackfill = {
      inicio,
      fim,
      filiais,
      etapa: 'resumos',
      diaAtual: fim,
      totalDias: opcoes.dias,
      diasFeitos: 0,
      iniciadoEm: new Date().toISOString(),
    };

    await this.salvar(tenantId, plano);
    this.logger.info(
      {
        event: 'backfill_iniciado',
        tenant_id: tenantId,
        dias: opcoes.dias,
        filiais: filiais.length,
      },
      'backfill_iniciado',
    );

    return plano;
  }

  async cancelar(tenantId: string): Promise<void> {
    const plano = await this.plano(tenantId);
    if (!plano) return;

    await this.salvar(tenantId, { ...plano, etapa: 'concluido' });
    this.logger.info({ event: 'backfill_cancelado', tenant_id: tenantId }, 'backfill_cancelado');
  }

  async progresso(tenantId: string): Promise<ProgressoBackfill> {
    const plano = await this.plano(tenantId);
    if (!plano) return { ativo: false, plano: null, percentual: 0 };

    const percentual =
      plano.totalDias > 0
        ? Math.min(100, Math.round((plano.diasFeitos / plano.totalDias) * 100))
        : 0;

    return { ativo: plano.etapa !== 'concluido', plano, percentual };
  }

  /**
   * Executa um passo. Devolve `concluido: false` enquanto houver o que fazer — quem chama
   * reenfileira, e é essa repetição que torna o backfill retomável de graça.
   */
  async executarPasso(tenantId: string): Promise<{ concluido: boolean; dias: number }> {
    const plano = await this.plano(tenantId);
    if (!plano || plano.etapa === 'concluido') return { concluido: true, dias: 0 };

    if (plano.etapa === 'resumos') {
      await this.carregarResumos(tenantId, plano);
      await this.salvar(tenantId, { ...plano, etapa: 'vendas', diaAtual: plano.fim });
      return { concluido: false, dias: 0 };
    }

    let dia = plano.diaAtual;
    let processados = 0;

    // diferencaEmDias(inicio, dia) = dia - inicio: continua enquanto o dia ainda não passou
    // do começo da janela (a carga anda para trás).
    while (processados < DIAS_POR_EXECUCAO && diferencaEmDias(plano.inicio, dia) >= 0) {
      for (const filial of plano.filiais) {
        const desfecho = await this.sync.executar({
          tenantId,
          domain: 'vendas_dia',
          filialErpId: filial,
          data: dia,
          trigger: 'backfill',
        });

        // Falha de um dia não derruba a carga inteira: ela fica registrada no histórico de
        // execuções e o dia volta na reconciliação (doc 14 §4).
        if (desfecho.status === 'error') {
          this.logger.warn(
            {
              event: 'backfill_dia_falhou',
              tenant_id: tenantId,
              filial,
              data: dia,
              motivo: desfecho.erro,
            },
            'backfill_dia_falhou',
          );
        }
      }

      processados += 1;
      dia = somarDias(dia, -1);
    }

    const concluido = diferencaEmDias(plano.inicio, dia) < 0;
    await this.salvar(tenantId, {
      ...plano,
      diaAtual: dia,
      diasFeitos: plano.diasFeitos + processados,
      etapa: concluido ? 'concluido' : 'vendas',
    });

    if (concluido) {
      this.logger.info(
        { event: 'backfill_concluido', tenant_id: tenantId, dias: plano.totalDias },
        'backfill_concluido',
      );
    }

    return { concluido, dias: processados };
  }

  /**
   * Resumos primeiro, em fatias de 30 dias (limite da API). Eles são baratos e trazem as marcas
   * de fechamento — sem elas, a consolidação de vendas não saberia quais dias já acabaram.
   */
  private async carregarResumos(tenantId: string, plano: PlanoBackfill): Promise<void> {
    for (const filial of plano.filiais) {
      for (const fatia of fatiar(plano.inicio, plano.fim, JANELA_MAXIMA_DIAS)) {
        await this.sync.executar({
          tenantId,
          domain: 'resumo_filial',
          filialErpId: filial,
          // O job de resumo deduziria a janela da marca d'água; aqui a fatia é explícita.
          periodo: fatia,
          trigger: 'backfill',
        });
      }
    }
  }

  private async plano(tenantId: string): Promise<PlanoBackfill | null> {
    const marca = await this.watermarks.obter(tenantId, 'backfill', SEM_FILIAL);
    return (marca?.cursor as PlanoBackfill | undefined) ?? null;
  }

  private async salvar(tenantId: string, plano: PlanoBackfill): Promise<void> {
    await this.watermarks.concluir(tenantId, 'backfill', {
      cursor: plano as unknown as Record<string, unknown>,
      watermarkTs: new Date(),
    });
  }

  private async filiais(tenantId: string): Promise<number[]> {
    const linhas = await this.tenantDb.run(tenantId, (tx) =>
      tx.erpFilial.findMany({
        where: { ativa: true },
        select: { erpId: true },
        orderBy: { erpId: 'asc' },
      }),
    );
    return linhas.map((linha) => linha.erpId);
  }

  private async timezoneDoTenant(tenantId: string): Promise<string> {
    const tenant = await this.tenantDb.run(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
    );
    return tenant?.timezone ?? 'America/Sao_Paulo';
  }
}
