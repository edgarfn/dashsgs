import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDatabase } from '../../common/tenant';
import { FrescorService } from './frescor.service';
import { filtroFiliais } from './home.service';

/** Faixas do aging (doc 15 §5). "Vencido" primeiro porque é o que exige ação hoje. */
export const BUCKETS = ['vencido', 'ate7', 'ate30', 'ate90', 'acima90'] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface AgingView {
  tipo: 'pagar' | 'receber';
  total: number;
  buckets: Array<{ bucket: Bucket; rotulo: string; valor: number; parcelas: number }>;
}

export interface FinanceiroView {
  aging: { pagar: AgingView; receber: AgingView };
  fluxo: Array<{ semana: string; pagar: number; receber: number; saldo: number }>;
  despesas: {
    total: number;
    porTipo: Array<{
      tipoErpId: string | null;
      descricao: string;
      classificacao: string | null;
      valor: number;
      participacaoPct: number;
    }>;
    fixasPct: number | null;
  };
  cartoes: {
    volumeBruto: number;
    valorTaxas: number;
    taxaMediaPct: number | null;
    porBandeira: Array<{
      bandeira: string;
      adquirente: string | null;
      volume: number;
      taxaMediaPct: number | null;
      transacoes: number;
    }>;
    naoConciliados: { transacoes: number; valor: number };
  };
  periodo: { de: string; ate: string };
  frescor: { atualizadoEm: string | null; atrasado: boolean; provisorio: boolean };
}

const ROTULO_BUCKET: Record<Bucket, string> = {
  vencido: 'Vencido',
  ate7: 'Até 7 dias',
  ate30: 'Até 30 dias',
  ate90: 'Até 90 dias',
  acima90: 'Acima de 90 dias',
};

/**
 * Financeiro: aging, fluxo previsto, despesas e cartões (doc 15 §5 / E7-08).
 *
 * Duas escolhas de leitura explicam as consultas:
 *
 * - **O aging é de parcela, não de título.** O vencimento mora na parcela; um título com três
 *   parcelas pode ter uma vencida e duas a vencer, e somar pelo título esconderia isso.
 * - **"Vencido" é uma faixa, não um erro.** Toda rede tem título vencido em algum momento; o que
 *   o gestor quer é o tamanho relativo dele contra o que ainda vai vencer.
 */
@Injectable()
export class FinanceiroService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly frescor: FrescorService,
  ) {}

  async montar(params: {
    tenantId: string;
    filiais: number[] | null;
    de: string;
    ate: string;
    /**
     * Hoje no fuso do tenant (`AAAA-MM-DD`).
     *
     * Aqui o relógio decide se um título está **vencido** ou **a vencer** — a diferença entre
     * "cobre hoje" e "cobre semana que vem". Usar `CURRENT_DATE` (UTC) marcava como vencido, na
     * virada do dia, o boleto que ainda vence hoje para quem opera a loja (doc 34 §4.5).
     */
    hoje: string;
  }): Promise<FinanceiroView> {
    const { tenantId, de, ate, hoje } = params;
    const recorte = filtroFiliais(params.filiais);

    const [pagar, receber, fluxo, despesas, cartoes, naoConciliados] = await this.tenantDb.run(
      tenantId,
      async (tx) => [
        await this.aging(tx, 'pagar', hoje),
        await this.aging(tx, 'receber', hoje),

        // Fluxo previsto por semana: o horizonte que cabe numa conversa de caixa (doc 15 §5).
        await tx.$queryRaw<Array<{ semana: Date; pagar: number | null; receber: number | null }>>(
          Prisma.sql`
            SELECT semana,
                   SUM(pagar)::float8 AS pagar,
                   SUM(receber)::float8 AS receber
            FROM (
              SELECT DATE_TRUNC('week', data_vencimento)::date AS semana,
                     COALESCE(saldo, valor_documento) AS pagar,
                     0 AS receber
              FROM erp_conta_pagar_parcelas
              WHERE paga = false AND data_vencimento >= ${hoje}::date
              UNION ALL
              SELECT DATE_TRUNC('week', data_vencimento)::date AS semana,
                     0 AS pagar,
                     COALESCE(saldo, valor_documento) AS receber
              FROM erp_conta_receber_parcelas
              WHERE paga = false AND data_vencimento >= ${hoje}::date
            ) movimentos
            GROUP BY semana
            ORDER BY semana
            LIMIT 13`,
        ),

        await tx.$queryRaw<
          Array<{
            tipo_erp_id: string | null;
            descricao: string | null;
            classificacao: string | null;
            valor: number;
          }>
        >(Prisma.sql`
          SELECT d.tipo_despesa_erp_id AS tipo_erp_id,
                 t.descricao,
                 COALESCE(t.classificacao, d.classificacao) AS classificacao,
                 SUM(d.valor)::float8 AS valor
          FROM erp_despesas d
          LEFT JOIN erp_tipos_despesa t
            ON t.tenant_id = d.tenant_id AND t.erp_id = d.tipo_despesa_erp_id
          WHERE d.data_despesa BETWEEN ${de}::date AND ${ate}::date
            ${recorte('d.filial_erp_id')}
          GROUP BY d.tipo_despesa_erp_id, t.descricao, COALESCE(t.classificacao, d.classificacao)
          ORDER BY valor DESC
          LIMIT 30`),

        await tx.$queryRaw<
          Array<{
            bandeira: string | null;
            adquirente: string | null;
            volume: number;
            taxa: number | null;
            transacoes: number;
          }>
        >(Prisma.sql`
          SELECT bandeira,
                 adquirente,
                 SUM(valor_bruto)::float8 AS volume,
                 -- Taxa média **ponderada pelo volume**: a média simples daria peso igual a uma
                 -- transação de R$ 5 e a uma de R$ 5.000.
                 (SUM(valor_bruto * COALESCE(taxa_pct, 0)) / NULLIF(SUM(valor_bruto), 0))::float8 AS taxa,
                 COUNT(*)::int AS transacoes
          FROM erp_cartao_vendas
          WHERE data_venda BETWEEN ${de}::date AND ${ate}::date
            ${recorte('filial_erp_id')}
          GROUP BY bandeira, adquirente
          ORDER BY volume DESC`),

        await tx.$queryRaw<Array<{ transacoes: number; valor: number | null }>>(Prisma.sql`
          SELECT COUNT(*)::int AS transacoes, SUM(valor_bruto)::float8 AS valor
          FROM erp_cartao_vendas
          WHERE baixada = false
            AND data_venda <= ${hoje}::date - 7
            ${recorte('filial_erp_id')}`),
      ],
    );

    const totalDespesas = despesas.reduce((total, linha) => total + Number(linha.valor), 0);
    const fixas = despesas
      .filter((linha) => (linha.classificacao ?? '').toUpperCase().startsWith('FIX'))
      .reduce((total, linha) => total + Number(linha.valor), 0);

    const volumeBruto = cartoes.reduce((total, linha) => total + Number(linha.volume), 0);
    const valorTaxas = cartoes.reduce(
      (total, linha) => total + (Number(linha.volume) * Number(linha.taxa ?? 0)) / 100,
      0,
    );

    return {
      aging: { pagar, receber },
      fluxo: fluxo.map((linha) => {
        const aPagar = Number(linha.pagar ?? 0);
        const aReceber = Number(linha.receber ?? 0);
        return {
          semana: linha.semana.toISOString().slice(0, 10),
          pagar: aPagar,
          receber: aReceber,
          saldo: aReceber - aPagar,
        };
      }),
      despesas: {
        total: totalDespesas,
        porTipo: despesas.map((linha) => ({
          tipoErpId: linha.tipo_erp_id,
          descricao: linha.descricao ?? linha.tipo_erp_id ?? '(sem tipo)',
          classificacao: linha.classificacao,
          valor: Number(linha.valor),
          participacaoPct: totalDespesas > 0 ? (Number(linha.valor) / totalDespesas) * 100 : 0,
        })),
        fixasPct: totalDespesas > 0 ? (fixas / totalDespesas) * 100 : null,
      },
      cartoes: {
        volumeBruto,
        valorTaxas,
        taxaMediaPct: volumeBruto > 0 ? (valorTaxas / volumeBruto) * 100 : null,
        porBandeira: cartoes.map((linha) => ({
          bandeira: linha.bandeira ?? '(sem bandeira)',
          adquirente: linha.adquirente,
          volume: Number(linha.volume),
          taxaMediaPct: linha.taxa === null ? null : Number(linha.taxa),
          transacoes: linha.transacoes,
        })),
        naoConciliados: {
          transacoes: naoConciliados[0]?.transacoes ?? 0,
          valor: Number(naoConciliados[0]?.valor ?? 0),
        },
      },
      periodo: { de, ate },
      frescor: await this.frescor.de(tenantId, 'financeiro', null),
    };
  }

  /**
   * Aging por faixa de vencimento. As faixas são calculadas em SQL porque trazer todas as
   * parcelas para somar em memória daria o mesmo resultado com dez vezes mais tráfego — mas a
   * data de corte vem de FORA, no fuso do tenant, e não do relógio do banco.
   */
  private async aging(
    tx: Parameters<Parameters<TenantDatabase['run']>[1]>[0],
    tipo: 'pagar' | 'receber',
    hoje: string,
  ): Promise<AgingView> {
    const tabela = Prisma.raw(
      tipo === 'pagar' ? 'erp_conta_pagar_parcelas' : 'erp_conta_receber_parcelas',
    );

    const linhas = await tx.$queryRaw<Array<{ bucket: string; valor: number; parcelas: number }>>(
      Prisma.sql`
        SELECT CASE
                 WHEN data_vencimento < ${hoje}::date THEN 'vencido'
                 WHEN data_vencimento <= ${hoje}::date + 7 THEN 'ate7'
                 WHEN data_vencimento <= ${hoje}::date + 30 THEN 'ate30'
                 WHEN data_vencimento <= ${hoje}::date + 90 THEN 'ate90'
                 ELSE 'acima90'
               END AS bucket,
               SUM(COALESCE(saldo, valor_documento))::float8 AS valor,
               COUNT(*)::int AS parcelas
        FROM ${tabela}
        WHERE paga = false AND data_vencimento IS NOT NULL
        GROUP BY bucket`,
    );

    const porBucket = new Map(linhas.map((linha) => [linha.bucket, linha]));

    return {
      tipo,
      total: linhas.reduce((total, linha) => total + Number(linha.valor), 0),
      buckets: BUCKETS.map((bucket) => ({
        bucket,
        rotulo: ROTULO_BUCKET[bucket],
        valor: Number(porBucket.get(bucket)?.valor ?? 0),
        parcelas: porBucket.get(bucket)?.parcelas ?? 0,
      })),
    };
  }
}
