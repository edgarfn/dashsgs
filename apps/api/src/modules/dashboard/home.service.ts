import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { diaEm, somarDias } from '../../common/datas';
import { TenantDatabase } from '../../common/tenant';
import { type BaseDeCusto } from './dto/dashboard.dto';
import { FrescorService } from './frescor.service';
import {
  type DiaConsolidado,
  type FechamentoFilial,
  type HomeView,
  type PontoDaCurva,
  type ResumoDoDia,
  type VendaPorFilial,
} from './dashboard.types';

/** Semanas anteriores usadas na curva comparativa (doc 15 §1: média das 4 mesmas semanas). */
const SEMANAS_DE_REFERENCIA = 4;

/** Coluna do resumo diário correspondente a cada base de custo (doc 15 §1). */
const COLUNA_DE_CUSTO: Record<BaseDeCusto, string> = {
  medio: 'custo_medio',
  real: 'custo_real',
  com_encargos: 'custo_com_encargos',
  fiscal_medio: 'custo_fiscal_medio',
  sem_icms: 'custo_sem_icms',
};

/**
 * Visão executiva (doc 15 §1 / E7-01).
 *
 * A tela responde "como está o dia?" em cinco segundos, e por isso o serviço faz o trabalho todo
 * antes: nenhuma chamada ao ERP no caminho do request (doc 04 §3.1), só leitura do espelho e dos
 * agregados que o sync já deixou prontos.
 *
 * Duas ideias moldam os números aqui:
 *
 * - **Hoje é provisório.** Vem de `/vendas/hoje`, que o ERP ainda recalcula no fechamento. A UI
 *   mostra isso; misturar com o consolidado daria a impressão de que o número já é definitivo.
 * - **A comparação é com o mesmo dia da semana.** Sábado com sábado. Comparar segunda com
 *   domingo produziria "queda de 40%" todo início de semana, e o alerta viraria ruído.
 */
@Injectable()
export class HomeService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly frescor: FrescorService,
  ) {}

  async montar(params: {
    tenantId: string;
    timezone: string;
    filiais: number[] | null;
    baseDeCusto: BaseDeCusto;
    /** Margem e status de fechamento são de manager+ (doc 15 §1). */
    podeVerMargem: boolean;
  }): Promise<HomeView> {
    const hoje = diaEm(new Date(), params.timezone);

    const [resumoHoje, consolidado, fechamento] = await Promise.all([
      this.hoje(params.tenantId, hoje, params.filiais),
      this.consolidado(
        params.tenantId,
        hoje,
        params.filiais,
        params.baseDeCusto,
        params.podeVerMargem,
      ),
      params.podeVerMargem
        ? this.fechamento(params.tenantId, params.filiais)
        : Promise.resolve([] as FechamentoFilial[]),
    ]);

    return {
      hoje: resumoHoje,
      consolidado,
      fechamento,
      semDados: resumoHoje.cupons === 0 && consolidado.data === null,
    };
  }

  // ---------------------------------------------------------------- dia corrente
  private async hoje(
    tenantId: string,
    dia: string,
    filiais: number[] | null,
  ): Promise<ResumoDoDia> {
    const recorte = filtroFiliais(filiais);

    const [porFilial, curva, historico] = await this.tenantDb.run(tenantId, async (tx) => [
      await tx.$queryRaw<
        Array<{ filial_erp_id: number; nome: string | null; venda: number; cupons: number }>
      >(Prisma.sql`
        SELECT c.filial_erp_id,
               COALESCE(f.nome_fantasia, f.razao_social) AS nome,
               COALESCE(SUM(c.valor_total), 0)::float8 AS venda,
               COUNT(*)::int AS cupons
        FROM erp_vendas_cupons c
        LEFT JOIN erp_filiais f
          ON f.tenant_id = c.tenant_id AND f.erp_id = c.filial_erp_id
        WHERE c.data = ${dia}::date
          AND c.cancelada = false
          ${recorte('c.filial_erp_id')}
        GROUP BY c.filial_erp_id, f.nome_fantasia, f.razao_social
        ORDER BY venda DESC`),

      await tx.$queryRaw<Array<{ hora: number; valor: number; cupons: number }>>(Prisma.sql`
        SELECT hora,
               SUM(valor)::float8 AS valor,
               SUM(cupons)::int AS cupons
        FROM agg_vendas_hora
        WHERE data = ${dia}::date
          ${recorte('filial_erp_id')}
        GROUP BY hora
        ORDER BY hora`),

      // Média das mesmas horas nas quatro semanas anteriores — a régua honesta para o dia.
      await tx.$queryRaw<Array<{ hora: number; media: number }>>(Prisma.sql`
        SELECT hora, (SUM(valor) / ${SEMANAS_DE_REFERENCIA})::float8 AS media
        FROM agg_vendas_hora
        WHERE data IN (${Prisma.join(
          Array.from(
            { length: SEMANAS_DE_REFERENCIA },
            (_, i) => Prisma.sql`${somarDias(dia, -7 * (i + 1))}::date`,
          ),
        )})
          ${recorte('filial_erp_id')}
        GROUP BY hora`),
    ]);

    const mediaPorHora = new Map(historico.map((linha) => [linha.hora, Number(linha.media)]));

    const filiaisView: VendaPorFilial[] = porFilial.map((linha) => ({
      filialErpId: linha.filial_erp_id,
      nome: linha.nome ?? `Filial ${linha.filial_erp_id}`,
      venda: Number(linha.venda),
      cupons: linha.cupons,
      ticketMedio: linha.cupons > 0 ? Number(linha.venda) / linha.cupons : 0,
    }));

    const venda = filiaisView.reduce((total, item) => total + item.venda, 0);
    const cupons = filiaisView.reduce((total, item) => total + item.cupons, 0);

    const pontos: PontoDaCurva[] = curva.map((linha) => ({
      hora: linha.hora,
      valor: Number(linha.valor),
      cupons: linha.cupons,
      mediaHistorica: mediaPorHora.get(linha.hora) ?? null,
    }));

    return {
      data: dia,
      venda,
      cupons,
      ticketMedio: cupons > 0 ? venda / cupons : 0,
      porFilial: filiaisView,
      curva: pontos,
      frescor: await this.frescor.de(tenantId, 'vendas_hoje', filiais, { provisorio: true }),
    };
  }

  // ---------------------------------------------------------------- último dia fechado
  private async consolidado(
    tenantId: string,
    hoje: string,
    filiais: number[] | null,
    baseDeCusto: BaseDeCusto,
    podeVerMargem: boolean,
  ): Promise<DiaConsolidado> {
    const recorte = filtroFiliais(filiais);
    const colunaCusto = Prisma.raw(COLUNA_DE_CUSTO[baseDeCusto]);

    const frescor = await this.frescor.de(tenantId, 'resumo_filial', filiais);

    const linhas = await this.tenantDb.run(tenantId, (tx) =>
      tx.$queryRaw<
        Array<{ data: Date; venda: number; clientes: number | null; custo: number | null }>
      >(Prisma.sql`
        SELECT data,
               SUM(valor)::float8 AS venda,
               SUM(qtd_clientes)::int AS clientes,
               SUM(${colunaCusto})::float8 AS custo
        FROM erp_filial_venda_resumo
        WHERE data < ${hoje}::date
          AND gerou_vendas_diaria = true
          ${recorte('filial_erp_id')}
        GROUP BY data
        ORDER BY data DESC
        LIMIT 1`),
    );

    const ultimo = linhas[0];
    if (!ultimo) {
      return {
        data: null,
        venda: 0,
        clientes: null,
        ticketMedio: null,
        margemPct: null,
        baseDeCusto,
        vendaSemanaAnterior: null,
        variacaoPct: null,
        frescor,
      };
    }

    const data = ultimo.data.toISOString().slice(0, 10);
    const venda = Number(ultimo.venda);
    const custo = ultimo.custo === null ? null : Number(ultimo.custo);

    const semanaAnterior = await this.tenantDb.run(tenantId, (tx) =>
      tx.$queryRaw<Array<{ venda: number }>>(Prisma.sql`
        SELECT SUM(valor)::float8 AS venda
        FROM erp_filial_venda_resumo
        WHERE data = ${somarDias(data, -7)}::date
          ${recorte('filial_erp_id')}`),
    );

    const vendaSemanaAnterior =
      semanaAnterior[0]?.venda === null || semanaAnterior[0]?.venda === undefined
        ? null
        : Number(semanaAnterior[0].venda);

    return {
      data,
      venda,
      clientes: ultimo.clientes,
      ticketMedio: ultimo.clientes && ultimo.clientes > 0 ? venda / ultimo.clientes : null,
      margemPct:
        podeVerMargem && custo !== null && venda > 0 ? ((venda - custo) / venda) * 100 : null,
      baseDeCusto,
      vendaSemanaAnterior,
      variacaoPct:
        vendaSemanaAnterior && vendaSemanaAnterior > 0
          ? ((venda - vendaSemanaAnterior) / vendaSemanaAnterior) * 100
          : null,
      frescor,
    };
  }

  // ---------------------------------------------------------------- status de fechamento
  /**
   * Marcas de fechamento da última data conhecida por filial (doc 15 §1).
   *
   * É o quadro que o gerente olha de manhã: quem já fechou o dia, quem não gerou a venda diária,
   * quem está com divergência apontada pelo próprio ERP.
   */
  private async fechamento(
    tenantId: string,
    filiais: number[] | null,
  ): Promise<FechamentoFilial[]> {
    const recorte = filtroFiliais(filiais);

    const linhas = await this.tenantDb.run(tenantId, (tx) =>
      tx.$queryRaw<
        Array<{
          filial_erp_id: number;
          nome: string | null;
          data: Date | null;
          atualizou_estoque: boolean;
          gerou_vendas_diaria: boolean;
          exportou_vendas: boolean;
          possui_divergencia: boolean;
        }>
      >(Prisma.sql`
        SELECT DISTINCT ON (r.filial_erp_id)
               r.filial_erp_id,
               COALESCE(f.nome_fantasia, f.razao_social) AS nome,
               r.data,
               r.atualizou_estoque,
               r.gerou_vendas_diaria,
               r.exportou_vendas,
               r.possui_divergencia
        FROM erp_filial_venda_resumo r
        LEFT JOIN erp_filiais f
          ON f.tenant_id = r.tenant_id AND f.erp_id = r.filial_erp_id
        WHERE TRUE ${recorte('r.filial_erp_id')}
        ORDER BY r.filial_erp_id, r.data DESC`),
    );

    return linhas.map((linha) => ({
      filialErpId: linha.filial_erp_id,
      nome: linha.nome ?? `Filial ${linha.filial_erp_id}`,
      data: linha.data ? linha.data.toISOString().slice(0, 10) : null,
      atualizouEstoque: linha.atualizou_estoque,
      gerouVendasDiaria: linha.gerou_vendas_diaria,
      exportouVendas: linha.exportou_vendas,
      possuiDivergencia: linha.possui_divergencia,
    }));
  }
}

/**
 * Cláusula de recorte por filial para SQL cru.
 *
 * A RLS já garante o tenant; isto aqui é o recorte **dentro** do tenant (doc 07 §4.2). Fica como
 * função para que nenhuma consulta nova esqueça o `AND` — esquecer significaria mostrar a loja
 * que o usuário não pode ver.
 */
export function filtroFiliais(filiais: number[] | null) {
  return (coluna: string): Prisma.Sql =>
    filiais === null || filiais.length === 0
      ? Prisma.empty
      : Prisma.sql`AND ${Prisma.raw(coluna)} IN (${Prisma.join(filiais)})`;
}
