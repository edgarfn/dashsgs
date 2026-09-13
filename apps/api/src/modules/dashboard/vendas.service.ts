import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { diaDaSemana, diferencaEmDias } from '../../common/datas';
import { TenantDatabase } from '../../common/tenant';
import { type BaseDeCusto } from './dto/dashboard.dto';
import { filtroFiliais } from './home.service';
import { FrescorService } from './frescor.service';
import { type ComparativoView, type CupomView, type VendasDiaView } from './dashboard.types';

const COLUNA_DE_CUSTO: Record<BaseDeCusto, string> = {
  medio: 'custo_medio',
  real: 'custo_real',
  com_encargos: 'custo_com_encargos',
  fiscal_medio: 'custo_fiscal_medio',
  sem_icms: 'custo_sem_icms',
};

/**
 * Vendas: o dia em detalhe e o período em comparação (doc 15 §2 / E7-02).
 *
 * O diário é o nível mais fundo que o MVP oferece — cupom a cupom, com filtros de caixa e
 * cancelamento. É a tela que o gerente abre quando o total do dia "não bate": aqui ele vê o
 * cupom, e no ERP ele resolve.
 *
 * O comparativo lê o **resumo diário** (uma linha por filial×dia), não os cupons: o total do mês
 * de uma rede são dezenas de milhares de cupons, e somar isso a cada request torraria o orçamento
 * de 300 ms do doc 04 §3.1 sem mudar uma vírgula no resultado.
 */
@Injectable()
export class VendasService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly frescor: FrescorService,
  ) {}

  async doDia(params: {
    tenantId: string;
    data: string;
    filiais: number[] | null;
    caixa?: number;
    canceladas?: 'true' | 'false';
    pagina: number;
    itensPorPagina: number;
  }): Promise<VendasDiaView> {
    const { tenantId, data } = params;
    const recorte = filtroFiliais(params.filiais);

    const filtroCaixa =
      params.caixa === undefined ? Prisma.empty : Prisma.sql`AND c.caixa = ${params.caixa}`;
    const filtroCancelada =
      params.canceladas === undefined
        ? Prisma.empty
        : Prisma.sql`AND c.cancelada = ${params.canceladas === 'true'}`;

    const offset = (params.pagina - 1) * params.itensPorPagina;

    const [totais, formas, cupons, contagem] = await this.tenantDb.run(tenantId, async (tx) => [
      await tx.$queryRaw<
        Array<{
          venda: number | null;
          cupons: number;
          canceladas: number;
          valor_cancelado: number | null;
          desconto: number | null;
          itens: number | null;
        }>
      >(Prisma.sql`
        SELECT
          SUM(c.valor_total) FILTER (WHERE c.cancelada = false)::float8 AS venda,
          COUNT(*) FILTER (WHERE c.cancelada = false)::int AS cupons,
          COUNT(*) FILTER (WHERE c.cancelada = true)::int AS canceladas,
          SUM(c.valor_total) FILTER (WHERE c.cancelada = true)::float8 AS valor_cancelado,
          (SELECT SUM(i.desconto)::float8 FROM erp_venda_itens i
            WHERE i.tenant_id = c.tenant_id AND i.data = c.data AND i.cancelado = false
              ${recorte('i.filial_erp_id')}) AS desconto,
          (SELECT SUM(i.quantidade)::float8 FROM erp_venda_itens i
            WHERE i.tenant_id = c.tenant_id AND i.data = c.data AND i.cancelado = false
              ${recorte('i.filial_erp_id')}) AS itens
        FROM erp_vendas_cupons c
        WHERE c.data = ${data}::date
          ${recorte('c.filial_erp_id')}
        GROUP BY c.tenant_id, c.data`),

      await tx.$queryRaw<Array<{ especie: string; valor: number }>>(Prisma.sql`
        SELECT especie, SUM(valor)::float8 AS valor
        FROM erp_finalizadora_lancamentos
        WHERE data = ${data}::date
          AND cancelada = false
          ${recorte('filial_erp_id')}
        GROUP BY especie
        ORDER BY valor DESC`),

      await tx.$queryRaw<
        Array<{
          filial_erp_id: number;
          nome: string | null;
          caixa: number;
          cupom: number;
          horario: string | null;
          valor_total: number;
          cancelada: boolean;
          identificada: boolean;
          vendedor_erp_id: number | null;
          itens: number;
          desconto: number | null;
          formas: string[] | null;
        }>
      >(Prisma.sql`
        SELECT c.filial_erp_id,
               COALESCE(f.nome_fantasia, f.razao_social) AS nome,
               c.caixa, c.cupom, c.horario, c.valor_total::float8, c.cancelada, c.identificada,
               c.vendedor_erp_id,
               (SELECT COUNT(*)::int FROM erp_venda_itens i
                 WHERE i.tenant_id = c.tenant_id AND i.filial_erp_id = c.filial_erp_id
                   AND i.data = c.data AND i.caixa = c.caixa AND i.cupom = c.cupom) AS itens,
               (SELECT SUM(i.desconto)::float8 FROM erp_venda_itens i
                 WHERE i.tenant_id = c.tenant_id AND i.filial_erp_id = c.filial_erp_id
                   AND i.data = c.data AND i.caixa = c.caixa AND i.cupom = c.cupom) AS desconto,
               (SELECT ARRAY_AGG(DISTINCT l.especie) FROM erp_finalizadora_lancamentos l
                 WHERE l.tenant_id = c.tenant_id AND l.filial_erp_id = c.filial_erp_id
                   AND l.data = c.data AND l.caixa = c.caixa AND l.cupom = c.cupom) AS formas
        FROM erp_vendas_cupons c
        LEFT JOIN erp_filiais f
          ON f.tenant_id = c.tenant_id AND f.erp_id = c.filial_erp_id
        WHERE c.data = ${data}::date
          ${recorte('c.filial_erp_id')}
          ${filtroCaixa}
          ${filtroCancelada}
        ORDER BY c.horario NULLS LAST, c.filial_erp_id, c.caixa, c.cupom
        LIMIT ${params.itensPorPagina} OFFSET ${offset}`),

      await tx.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS total
        FROM erp_vendas_cupons c
        WHERE c.data = ${data}::date
          ${recorte('c.filial_erp_id')}
          ${filtroCaixa}
          ${filtroCancelada}`),
    ]);

    const resumo = totais[0];
    const venda = Number(resumo?.venda ?? 0);
    const quantidade = resumo?.cupons ?? 0;
    const totalFormas = formas.reduce((total, linha) => total + Number(linha.valor), 0);
    const total = contagem[0]?.total ?? 0;

    const linhas: CupomView[] = cupons.map((linha) => ({
      filialErpId: linha.filial_erp_id,
      filialNome: linha.nome ?? `Filial ${linha.filial_erp_id}`,
      data,
      caixa: linha.caixa,
      cupom: linha.cupom,
      horario: linha.horario,
      itens: linha.itens,
      valorTotal: Number(linha.valor_total),
      desconto: Number(linha.desconto ?? 0),
      cancelada: linha.cancelada,
      identificada: linha.identificada,
      vendedorErpId: linha.vendedor_erp_id,
      formas: linha.formas ?? [],
    }));

    return {
      data,
      totais: {
        venda,
        cupons: quantidade,
        ticketMedio: quantidade > 0 ? venda / quantidade : 0,
        itensPorCupom: quantidade > 0 ? Number(resumo?.itens ?? 0) / quantidade : 0,
        desconto: Number(resumo?.desconto ?? 0),
        canceladas: resumo?.canceladas ?? 0,
        valorCancelado: Number(resumo?.valor_cancelado ?? 0),
      },
      formasDePagamento: formas.map((linha) => ({
        especie: linha.especie,
        valor: Number(linha.valor),
        participacaoPct: totalFormas > 0 ? (Number(linha.valor) / totalFormas) * 100 : 0,
      })),
      cupons: linhas,
      paginacao: {
        pagina: params.pagina,
        itensPorPagina: params.itensPorPagina,
        total,
        paginas: Math.max(1, Math.ceil(total / params.itensPorPagina)),
      },
      // O dia pedido pode ser hoje (provisório) ou um dia fechado — a tela precisa saber qual.
      frescor: await this.frescor.de(tenantId, 'vendas_dia', params.filiais, {
        provisorio: await this.ehProvisorio(tenantId, data, params.filiais),
      }),
    };
  }

  async comparativo(params: {
    tenantId: string;
    de: string;
    ate: string;
    filiais: number[] | null;
    baseDeCusto: BaseDeCusto;
    podeVerMargem: boolean;
  }): Promise<ComparativoView> {
    const { tenantId, de, ate } = params;
    const recorte = filtroFiliais(params.filiais);
    const colunaCusto = Prisma.raw(COLUNA_DE_CUSTO[params.baseDeCusto]);

    const [serie, porFilial, porDepartamento] = await this.tenantDb.run(tenantId, async (tx) => [
      await tx.$queryRaw<
        Array<{ data: Date; venda: number; clientes: number | null; custo: number | null }>
      >(Prisma.sql`
        SELECT data,
               SUM(valor)::float8 AS venda,
               SUM(qtd_clientes)::int AS clientes,
               SUM(${colunaCusto})::float8 AS custo
        FROM erp_filial_venda_resumo
        WHERE data BETWEEN ${de}::date AND ${ate}::date
          ${recorte('filial_erp_id')}
        GROUP BY data
        ORDER BY data`),

      await tx.$queryRaw<
        Array<{
          filial_erp_id: number;
          nome: string | null;
          venda: number;
          clientes: number | null;
        }>
      >(Prisma.sql`
        SELECT r.filial_erp_id,
               COALESCE(f.nome_fantasia, f.razao_social) AS nome,
               SUM(r.valor)::float8 AS venda,
               SUM(r.qtd_clientes)::int AS clientes
        FROM erp_filial_venda_resumo r
        LEFT JOIN erp_filiais f
          ON f.tenant_id = r.tenant_id AND f.erp_id = r.filial_erp_id
        WHERE r.data BETWEEN ${de}::date AND ${ate}::date
          ${recorte('r.filial_erp_id')}
        GROUP BY r.filial_erp_id, f.nome_fantasia, f.razao_social
        ORDER BY venda DESC`),

      // Departamento vem do agregado, que o sync recalcula por dia — não dos itens crus.
      await tx.$queryRaw<
        Array<{
          dep1_erp_id: string;
          nome: string | null;
          venda: number;
          quantidade: number;
          custo: number | null;
        }>
      >(Prisma.sql`
        SELECT a.dep1_erp_id,
               d.descricao AS nome,
               SUM(a.valor)::float8 AS venda,
               SUM(a.quantidade)::float8 AS quantidade,
               SUM(a.custo)::float8 AS custo
        FROM agg_vendas_dia_dep a
        LEFT JOIN erp_departamentos_n1 d
          ON d.tenant_id = a.tenant_id AND d.erp_id = a.dep1_erp_id
        WHERE a.data BETWEEN ${de}::date AND ${ate}::date
          ${recorte('a.filial_erp_id')}
        GROUP BY a.dep1_erp_id, d.descricao
        ORDER BY venda DESC
        LIMIT 50`),
    ]);

    const vendaTotal = serie.reduce((total, linha) => total + Number(linha.venda), 0);
    const clientesTotal = serie.reduce((total, linha) => total + (linha.clientes ?? 0), 0);
    const custoTotal = serie.reduce((total, linha) => total + Number(linha.custo ?? 0), 0);

    // Dia da semana: responde "que dia vende mais?", pergunta que todo varejista faz.
    const porDia = new Map<number, { venda: number; dias: number }>();
    for (const linha of serie) {
      const dia = diaDaSemana(linha.data.toISOString().slice(0, 10));
      const atual = porDia.get(dia) ?? { venda: 0, dias: 0 };
      porDia.set(dia, { venda: atual.venda + Number(linha.venda), dias: atual.dias + 1 });
    }

    return {
      periodo: { de, ate, dias: diferencaEmDias(de, ate) + 1 },
      totais: {
        venda: vendaTotal,
        clientes: clientesTotal,
        ticketMedio: clientesTotal > 0 ? vendaTotal / clientesTotal : 0,
        margemPct:
          params.podeVerMargem && vendaTotal > 0
            ? ((vendaTotal - custoTotal) / vendaTotal) * 100
            : null,
        baseDeCusto: params.baseDeCusto,
      },
      serie: serie.map((linha) => {
        const venda = Number(linha.venda);
        const custo = Number(linha.custo ?? 0);
        return {
          data: linha.data.toISOString().slice(0, 10),
          venda,
          clientes: linha.clientes ?? 0,
          margemPct: params.podeVerMargem && venda > 0 ? ((venda - custo) / venda) * 100 : null,
        };
      }),
      porFilial: porFilial.map((linha) => ({
        filialErpId: linha.filial_erp_id,
        nome: linha.nome ?? `Filial ${linha.filial_erp_id}`,
        venda: Number(linha.venda),
        clientes: linha.clientes ?? 0,
        participacaoPct: vendaTotal > 0 ? (Number(linha.venda) / vendaTotal) * 100 : 0,
      })),
      porDepartamento: porDepartamento.map((linha) => {
        const venda = Number(linha.venda);
        const custo = Number(linha.custo ?? 0);
        return {
          dep1ErpId: linha.dep1_erp_id,
          nome: linha.nome ?? linha.dep1_erp_id,
          venda,
          quantidade: Number(linha.quantidade),
          margemPct: params.podeVerMargem && venda > 0 ? ((venda - custo) / venda) * 100 : null,
        };
      }),
      porDiaDaSemana: [...porDia.entries()]
        .map(([diaSemana, valores]) => ({
          diaDaSemana: diaSemana,
          venda: valores.venda,
          media: valores.dias > 0 ? valores.venda / valores.dias : 0,
        }))
        .sort((a, b) => a.diaDaSemana - b.diaDaSemana),
      frescor: await this.frescor.de(tenantId, 'resumo_filial', params.filiais),
    };
  }

  /** Um dia é provisório enquanto houver cupom marcado como tempo real. */
  private async ehProvisorio(
    tenantId: string,
    data: string,
    filiais: number[] | null,
  ): Promise<boolean> {
    const recorte = filtroFiliais(filiais);
    const linhas = await this.tenantDb.run(tenantId, (tx) =>
      tx.$queryRaw<Array<{ provisorios: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS provisorios
        FROM erp_vendas_cupons
        WHERE data = ${data}::date
          AND is_realtime = true
          ${recorte('filial_erp_id')}`),
    );
    return (linhas[0]?.provisorios ?? 0) > 0;
  }
}
