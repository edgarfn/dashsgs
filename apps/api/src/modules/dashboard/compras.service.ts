import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDatabase } from '../../common/tenant';
import { FrescorService } from './frescor.service';
import { filtroFiliais } from './home.service';

export interface ComprasView {
  periodo: { de: string; ate: string };
  porSituacao: Array<{ situacao: string; pedidos: number; valor: number }>;
  leadTimeDias: { media: number | null; p90: number | null; atendidos: number };
  pendentesAntigos: Array<{
    erpId: number;
    filialNome: string | null;
    dataPedido: string | null;
    diasEmAberto: number;
    situacao: string | null;
    valorTotal: number;
  }>;
  entradas: { notas: number; valor: number };
  frescor: { atualizadoEm: string | null; atrasado: boolean; provisorio: boolean };
}

/** Um pedido parado além disto é exceção que merece olhar (doc 15 §6 "pendentes antigos"). */
const DIAS_PARA_PENDENTE_ANTIGO = 15;

/**
 * Compras: pedidos por situação, lead time e entradas (doc 15 §6 / E7-08).
 *
 * O lead time é medido do pedido ao **atendimento**, não à previsão: a previsão é promessa do
 * fornecedor, e o que interessa ao comprador é quanto ela costuma valer.
 */
@Injectable()
export class ComprasService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly frescor: FrescorService,
  ) {}

  async montar(params: {
    tenantId: string;
    filiais: number[] | null;
    de: string;
    ate: string;
  }): Promise<ComprasView> {
    const { tenantId, de, ate } = params;
    const recorte = filtroFiliais(params.filiais);

    const [situacoes, leadTime, pendentes, entradas] = await this.tenantDb.run(
      tenantId,
      async (tx) => [
        await tx.$queryRaw<
          Array<{ situacao: string | null; pedidos: number; valor: number | null }>
        >(
          Prisma.sql`
            SELECT situacao, COUNT(*)::int AS pedidos, SUM(valor_total)::float8 AS valor
            FROM erp_pedidos_compra
            WHERE data_pedido BETWEEN ${de}::date AND ${ate}::date
              ${recorte('filial_erp_id')}
            GROUP BY situacao
            ORDER BY pedidos DESC`,
        ),

        await tx.$queryRaw<Array<{ media: number | null; p90: number | null; atendidos: number }>>(
          Prisma.sql`
            SELECT AVG(data_atendimento - data_pedido)::float8 AS media,
                   PERCENTILE_CONT(0.9) WITHIN GROUP (
                     ORDER BY (data_atendimento - data_pedido)
                   )::float8 AS p90,
                   COUNT(*)::int AS atendidos
            FROM erp_pedidos_compra
            WHERE data_atendimento IS NOT NULL
              AND data_pedido IS NOT NULL
              AND data_pedido BETWEEN ${de}::date AND ${ate}::date
              ${recorte('filial_erp_id')}`,
        ),

        await tx.$queryRaw<
          Array<{
            erp_id: number;
            nome: string | null;
            data_pedido: Date | null;
            dias: number;
            situacao: string | null;
            valor_total: number | null;
          }>
        >(Prisma.sql`
          SELECT p.erp_id,
                 COALESCE(f.nome_fantasia, f.razao_social) AS nome,
                 p.data_pedido,
                 (CURRENT_DATE - p.data_pedido)::int AS dias,
                 p.situacao,
                 p.valor_total::float8
          FROM erp_pedidos_compra p
          LEFT JOIN erp_filiais f
            ON f.tenant_id = p.tenant_id AND f.erp_id = p.filial_erp_id
          WHERE p.data_atendimento IS NULL
            AND p.data_pedido IS NOT NULL
            -- Cast explícito: o driver manda número como int8, e date menos int8 não existe.
            AND p.data_pedido <= CURRENT_DATE - ${DIAS_PARA_PENDENTE_ANTIGO}::int
            AND COALESCE(p.situacao, '') <> 'atendido'
            ${recorte('p.filial_erp_id')}
          ORDER BY dias DESC
          LIMIT 50`),

        await tx.$queryRaw<Array<{ notas: number; valor: number | null }>>(Prisma.sql`
          SELECT COUNT(*)::int AS notas, SUM(valor_total)::float8 AS valor
          FROM erp_notas_entrada
          WHERE data_entrada BETWEEN ${de}::date AND ${ate}::date
            ${recorte('filial_erp_id')}`),
      ],
    );

    return {
      periodo: { de, ate },
      porSituacao: situacoes.map((linha) => ({
        situacao: linha.situacao ?? '(sem situação)',
        pedidos: linha.pedidos,
        valor: Number(linha.valor ?? 0),
      })),
      leadTimeDias: {
        media: leadTime[0]?.media === null ? null : Number(leadTime[0]?.media ?? 0),
        p90: leadTime[0]?.p90 === null ? null : Number(leadTime[0]?.p90 ?? 0),
        atendidos: leadTime[0]?.atendidos ?? 0,
      },
      pendentesAntigos: pendentes.map((linha) => ({
        erpId: linha.erp_id,
        filialNome: linha.nome,
        dataPedido: linha.data_pedido ? linha.data_pedido.toISOString().slice(0, 10) : null,
        diasEmAberto: linha.dias,
        situacao: linha.situacao,
        valorTotal: Number(linha.valor_total ?? 0),
      })),
      entradas: {
        notas: entradas[0]?.notas ?? 0,
        valor: Number(entradas[0]?.valor ?? 0),
      },
      frescor: await this.frescor.de(tenantId, 'compras', null),
    };
  }
}
