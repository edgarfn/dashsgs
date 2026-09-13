import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { JANELA_MAXIMA_DIAS, SgClient } from '../../../integration/sg';
import { TenantDatabase } from '../../../common/tenant';
import { type Coluna, upsertLote } from '../upsert-lote';
import { WatermarkService } from '../watermark.service';
import {
  type ContextoSync,
  type JobDeSync,
  type ResultadoSync,
  diferencaEmDias,
  somarDias,
} from '../sync.types';

/**
 * Resumo diário por filial (doc 14 §2 / E5-06).
 *
 * É o domínio mais barato e o mais estratégico: uma chamada traz o total do dia, os custos médios,
 * as contagens de estoque **e** as marcas de fechamento. São essas marcas que dizem à consolidação
 * de vendas que o dia acabou, e é `possuiDivergencia` que vira alerta para o dono da loja.
 *
 * A janela respeita o limite de 30 dias da API (doc 03); períodos maiores são fatiados.
 */

const COLUNAS: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'filial_erp_id', tipo: 'int' },
  { nome: 'data', tipo: 'date' },
  { nome: 'valor', tipo: 'numeric' },
  { nome: 'custo_real', tipo: 'numeric' },
  { nome: 'custo_sem_icms', tipo: 'numeric' },
  { nome: 'custo_com_encargos', tipo: 'numeric' },
  { nome: 'custo_medio', tipo: 'numeric' },
  { nome: 'custo_fiscal_medio', tipo: 'numeric' },
  { nome: 'aliq_media_icms', tipo: 'numeric' },
  { nome: 'aliq_media_pis_cofins', tipo: 'numeric' },
  { nome: 'qtd_clientes', tipo: 'int' },
  { nome: 'qtd_unidades', tipo: 'numeric' },
  { nome: 'prod_com_venda', tipo: 'int' },
  { nome: 'prod_estoque_abaixo_min', tipo: 'int' },
  { nome: 'prod_estoque_negativo', tipo: 'int' },
  { nome: 'prod_estoque_sem_venda', tipo: 'int' },
  { nome: 'margem_acima', tipo: 'int' },
  { nome: 'margem_abaixo', tipo: 'int' },
  { nome: 'margem_negativa', tipo: 'int' },
  { nome: 'atualizou_estoque', tipo: 'bool' },
  { nome: 'gerou_vendas_diaria', tipo: 'bool' },
  { nome: 'exportou_vendas', tipo: 'bool' },
  { nome: 'processou_scanntech', tipo: 'bool' },
  { nome: 'possui_divergencia', tipo: 'bool' },
  { nome: 'usuario_atualizou_estoque', tipo: 'text' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

/** Recuo padrão quando não há marca d'água: o mês corrente já dá um dashboard utilizável. */
const DIAS_INICIAIS = 30;
/**
 * Reprocesso da cauda: o ERP mexe em dias já fechados (estorno lançado no dia seguinte), e é o
 * resumo que denuncia. Sem esta sobreposição, a correção só apareceria num backfill manual.
 */
const DIAS_SOBREPOSICAO = 3;

@Injectable()
export class ResumoFilialSync implements JobDeSync {
  readonly domain = 'resumo_filial' as const;

  constructor(
    private readonly sg: SgClient,
    private readonly tenantDb: TenantDatabase,
    private readonly watermarks: WatermarkService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ResumoFilialSync.name);
  }

  async executar(contexto: ContextoSync): Promise<ResultadoSync> {
    const filialErpId = contexto.filialErpId;
    if (filialErpId === undefined) throw new Error('resumo_filial exige filial');
    if (!contexto.data) throw new Error('resumo_filial exige o dia corrente do tenant');

    const { inicio, fim } = await this.janela(contexto, filialErpId);
    if (diferencaEmDias(inicio, fim) < 0) {
      return { observacao: 'nada novo desde a última marca' };
    }

    let items = 0;
    let invalid = 0;
    let apiCalls = 0;
    const agora = new Date();

    // A API recusa períodos acima de 30 dias: quem pede 90 recebe erro, não uma página a menos.
    for (const fatia of fatiar(inicio, fim, JANELA_MAXIMA_DIAS)) {
      const coleta = await this.sg.getResumoFilial(contexto.sg, {
        filiais: [filialErpId],
        dataInicial: fatia.inicio,
        dataFinal: fatia.fim,
      });
      apiCalls += coleta.paginas ?? 1;
      invalid += coleta.invalidos;

      items += await this.tenantDb.run(contexto.tenantId, (tx) =>
        upsertLote(
          tx,
          {
            tabela: 'erp_filial_venda_resumo',
            colunas: COLUNAS,
            chave: ['tenant_id', 'filial_erp_id', 'data'],
          },
          coleta.itens
            .filter((resumo) => resumo.data)
            .map((resumo) => ({
              tenant_id: contexto.tenantId,
              filial_erp_id: resumo.filialErpId || filialErpId,
              data: resumo.data,
              valor: resumo.valor,
              custo_real: resumo.custos.real,
              custo_sem_icms: resumo.custos.semIcms,
              custo_com_encargos: resumo.custos.comEncargos,
              custo_medio: resumo.custos.medio,
              custo_fiscal_medio: resumo.custos.fiscalMedio,
              aliq_media_icms: resumo.aliqMediaIcms,
              aliq_media_pis_cofins: resumo.aliqMediaPisCofins,
              qtd_clientes: resumo.qtdClientes,
              qtd_unidades: resumo.qtdUnidades,
              prod_com_venda: resumo.prodComVenda,
              prod_estoque_abaixo_min: resumo.prodEstoqueAbaixoMin,
              prod_estoque_negativo: resumo.prodEstoqueNegativo,
              prod_estoque_sem_venda: resumo.prodEstoqueSemVenda,
              margem_acima: resumo.margemAcima,
              margem_abaixo: resumo.margemAbaixo,
              margem_negativa: resumo.margemNegativa,
              atualizou_estoque: resumo.fechamento.atualizouEstoque,
              gerou_vendas_diaria: resumo.fechamento.gerouVendasDiaria,
              exportou_vendas: resumo.fechamento.exportouVendas,
              processou_scanntech: resumo.fechamento.processouScanntech,
              possui_divergencia: resumo.fechamento.possuiDivergencia,
              usuario_atualizou_estoque: resumo.fechamento.usuario,
              synced_at: agora,
            })),
        ),
      );

      const divergentes = coleta.itens.filter((resumo) => resumo.fechamento.possuiDivergencia);
      if (divergentes.length > 0) {
        // Vira alerta para o admin do tenant na Fase 8 (E8-05); por ora, fica no log de negócio.
        this.logger.warn(
          {
            event: 'sync_resumo_divergencia',
            tenant_id: contexto.tenantId,
            filial: filialErpId,
            dias: divergentes.map((resumo) => resumo.data),
          },
          'sync_resumo_divergencia',
        );
      }
    }

    return { items, invalid, apiCalls, pages: apiCalls, watermarkDate: fim };
  }

  private async janela(
    contexto: ContextoSync,
    filialErpId: number,
  ): Promise<{ inicio: string; fim: string }> {
    // Backfill manda a fatia; a cadência normal deduz da marca d'água.
    if (contexto.periodo) return contexto.periodo;

    const fim = somarDias(contexto.data as string, -1);
    const marca = await this.watermarks.obter(contexto.tenantId, this.domain, filialErpId);

    const inicio = marca?.watermarkDate
      ? somarDias(marca.watermarkDate, -DIAS_SOBREPOSICAO)
      : somarDias(fim, -(DIAS_INICIAIS - 1));

    return { inicio, fim };
  }
}

/** Quebra um período em fatias de no máximo `maximo` dias, preservando as bordas. */
export function fatiar(
  inicio: string,
  fim: string,
  maximo: number,
): Array<{ inicio: string; fim: string }> {
  const fatias: Array<{ inicio: string; fim: string }> = [];
  let cursor = inicio;

  while (diferencaEmDias(cursor, fim) >= 0) {
    const candidato = somarDias(cursor, maximo - 1);
    // diferencaEmDias(a, b) = b - a: negativo significa que o candidato passou do fim.
    const fimFatia = diferencaEmDias(candidato, fim) < 0 ? fim : candidato;
    fatias.push({ inicio: cursor, fim: fimFatia });
    cursor = somarDias(fimFatia, 1);
  }

  return fatias;
}
