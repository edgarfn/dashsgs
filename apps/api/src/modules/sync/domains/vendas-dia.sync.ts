import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { SgClient, SgError } from '../../../integration/sg';
import { TenantDatabase } from '../../../common/tenant';
import { WatermarkService } from '../watermark.service';
import {
  type ContextoSync,
  type JobDeSync,
  type ResultadoSync,
  diferencaEmDias,
  somarDias,
} from '../sync.types';
import { VendasPersistencia } from './vendas.persistencia';

/**
 * Consolidação do dia fechado (doc 14 §2, grupo "fechamento" / E5-05).
 *
 * Só consolida dia que o **ERP** declarou fechado (`gerouVendasDiaria` no resumo diário). Antes
 * disso, `/vendas?data=D` devolve um retrato que ainda vai mudar, e gravá-lo como definitivo faria
 * o dashboard alternar entre dois números — o pior defeito possível num painel de faturamento.
 *
 * Quando consolida, a gravação substitui o provisório do tempo real pelo definitivo, dentro da
 * mesma transação (ver `VendasPersistencia`).
 */

/** Dias fechados processados por execução: o resto fica para a próxima (ou para o backfill). */
const MAX_DIAS_POR_EXECUCAO = 3;
/** Sem marca d'água, começa por ontem — o histórico é assunto do backfill (E5-07). */
const DIAS_INICIAIS = 1;

@Injectable()
export class VendasDiaSync implements JobDeSync {
  readonly domain = 'vendas_dia' as const;

  constructor(
    private readonly sg: SgClient,
    private readonly persistencia: VendasPersistencia,
    private readonly watermarks: WatermarkService,
    private readonly tenantDb: TenantDatabase,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VendasDiaSync.name);
  }

  async executar(contexto: ContextoSync): Promise<ResultadoSync> {
    const filialErpId = contexto.filialErpId;
    if (filialErpId === undefined) throw new Error('vendas_dia exige filial');
    if (!contexto.data) throw new Error('vendas_dia exige o dia corrente do tenant');

    // Pedido explícito (backfill, re-sync manual): consolida aquele dia e pronto.
    if (contexto.trigger !== 'scheduler') {
      return this.consolidar(contexto, filialErpId, contexto.data, { exigirFechamento: false });
    }

    const dias = await this.diasPendentes(contexto, filialErpId);
    if (dias.length === 0) {
      return { observacao: 'nenhum dia fechado aguardando consolidação' };
    }

    let items = 0;
    let apiCalls = 0;
    let invalid = 0;
    let ultimoConsolidado: string | null = null;

    for (const dia of dias) {
      const parcial = await this.consolidar(contexto, filialErpId, dia, {
        exigirFechamento: true,
      });

      items += parcial.items ?? 0;
      apiCalls += parcial.apiCalls ?? 0;
      invalid += parcial.invalid ?? 0;

      // Dia ainda não fechado interrompe a fila: consolidar D+1 antes de D deixaria um buraco
      // que a marca d'água esconderia para sempre.
      if (!parcial.watermarkDate) break;
      ultimoConsolidado = parcial.watermarkDate;
    }

    return {
      items,
      apiCalls,
      invalid,
      pages: apiCalls,
      watermarkDate: ultimoConsolidado,
      observacao: ultimoConsolidado ? undefined : 'aguardando fechamento no ERP',
    };
  }

  private async consolidar(
    contexto: ContextoSync,
    filialErpId: number,
    dia: string,
    opcoes: { exigirFechamento: boolean },
  ): Promise<ResultadoSync> {
    if (opcoes.exigirFechamento && !(await this.diaFechado(contexto.tenantId, filialErpId, dia))) {
      return { observacao: `dia ${dia} ainda não fechado no ERP` };
    }

    const cupons = await this.sg.getVendasDia(contexto.sg, { filial: filialErpId, data: dia });
    const finalizadoras = await this.coletarFinalizadoras(contexto, filialErpId, dia);

    const gravado = await this.persistencia.gravarDia({
      tenantId: contexto.tenantId,
      filialErpId,
      data: dia,
      cupons: cupons.itens,
      finalizadoras: finalizadoras?.itens ?? [],
      isRealtime: false,
    });

    this.logger.info(
      {
        event: 'sync_dia_consolidado',
        tenant_id: contexto.tenantId,
        filial: filialErpId,
        data: dia,
        cupons: gravado.cupons,
        itens: gravado.itens,
      },
      'sync_dia_consolidado',
    );

    return {
      apiCalls: 2,
      pages: 2,
      items: gravado.cupons + gravado.itens + gravado.finalizadoras,
      invalid: cupons.invalidos + (finalizadoras?.invalidos ?? 0),
      watermarkDate: dia,
    };
  }

  /** A flag vem do resumo diário (E5-06): é o ERP dizendo "este dia acabou". */
  private async diaFechado(tenantId: string, filialErpId: number, dia: string): Promise<boolean> {
    const resumo = await this.tenantDb.run(tenantId, (tx) =>
      tx.erpFilialVendaResumo.findUnique({
        where: {
          tenantId_filialErpId_data: {
            tenantId,
            filialErpId,
            data: new Date(`${dia}T00:00:00Z`),
          },
        },
        select: { gerouVendasDiaria: true },
      }),
    );
    return resumo?.gerouVendasDiaria === true;
  }

  /** Dias entre a marca d'água e ontem, limitados para a execução não virar backfill disfarçado. */
  private async diasPendentes(contexto: ContextoSync, filialErpId: number): Promise<string[]> {
    const ontem = somarDias(contexto.data as string, -1);
    const marca = await this.watermarks.obter(contexto.tenantId, this.domain, filialErpId);

    const inicio = marca?.watermarkDate
      ? somarDias(marca.watermarkDate, 1)
      : somarDias(ontem, -(DIAS_INICIAIS - 1));

    if (diferencaEmDias(inicio, ontem) < 0) return [];

    const dias: string[] = [];
    for (let dia = inicio; diferencaEmDias(dia, ontem) >= 0; dia = somarDias(dia, 1)) {
      dias.push(dia);
      if (dias.length >= MAX_DIAS_POR_EXECUCAO) break;
    }
    return dias;
  }

  private async coletarFinalizadoras(contexto: ContextoSync, filial: number, data: string) {
    try {
      return await this.sg.getFinalizadoras(contexto.sg, { filial, data });
    } catch (erro) {
      if (erro instanceof SgError && erro.falha === 'rota_nao_contratada') return null;
      throw erro;
    }
  }
}
