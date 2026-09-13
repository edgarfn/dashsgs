import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDatabase } from '../../common/tenant';
import { type EstoqueView, type ProdutoEstoqueView } from './dashboard.types';
import { FrescorService } from './frescor.service';
import { filtroFiliais } from './home.service';

/** Condições de cada situação de estoque (doc 15 §4). */
const CONDICAO = {
  ruptura: Prisma.sql`p.estoque_atual < p.estoque_minimo AND p.estoque_minimo > 0`,
  negativo: Prisma.sql`p.estoque_atual < 0`,
  excesso: Prisma.sql`p.estoque_maximo > 0 AND p.estoque_atual > p.estoque_maximo`,
} as const;

/**
 * Estoque: ruptura, negativo e excesso (doc 15 §4 / E7-04 parcial).
 *
 * A lista é ordenada por **curva ABC primeiro, cobertura depois**: um item A parado é venda
 * perdida agora; um item C em falta pode esperar. Ordenar por valor de estoque, que seria o
 * óbvio, colocaria no topo justamente o que não dói.
 *
 * Vencimentos e perdas (as outras duas metades do doc 15 §4) dependem dos domínios de sync da
 * E5-10 e entram com eles.
 */
@Injectable()
export class EstoqueService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly frescor: FrescorService,
  ) {}

  async situacao(params: {
    tenantId: string;
    filiais: number[] | null;
    situacao: 'ruptura' | 'negativo' | 'excesso';
    curva?: 'A' | 'B' | 'C';
    pagina: number;
    itensPorPagina: number;
  }): Promise<EstoqueView> {
    const { tenantId } = params;
    const recorte = filtroFiliais(params.filiais);
    const condicao = CONDICAO[params.situacao];
    const filtroCurva =
      params.curva === undefined ? Prisma.empty : Prisma.sql`AND p.curva_abc = ${params.curva}`;
    const offset = (params.pagina - 1) * params.itensPorPagina;

    const [contagens, produtos, total] = await this.tenantDb.run(tenantId, async (tx) => [
      await tx.$queryRaw<
        Array<{ ruptura: number; negativo: number; excesso: number; curva_a: number }>
      >(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE ${CONDICAO.ruptura})::int AS ruptura,
          COUNT(*) FILTER (WHERE ${CONDICAO.negativo})::int AS negativo,
          COUNT(*) FILTER (WHERE ${CONDICAO.excesso})::int AS excesso,
          COUNT(*) FILTER (WHERE ${CONDICAO.ruptura} AND p.curva_abc = 'A')::int AS curva_a
        FROM erp_produtos p
        WHERE p.ativo = true
          ${recorte('p.filial_erp_id')}`),

      await tx.$queryRaw<
        Array<{
          erp_id: number;
          descricao: string;
          filial_erp_id: number;
          nome: string | null;
          curva_abc: string | null;
          estoque_atual: number;
          estoque_minimo: number;
          estoque_maximo: number | null;
          venda_media_diaria: number | null;
          preco_venda1: number | null;
          departamento: string | null;
        }>
      >(Prisma.sql`
        SELECT p.erp_id, p.descricao, p.filial_erp_id,
               COALESCE(f.nome_fantasia, f.razao_social) AS nome,
               p.curva_abc,
               p.estoque_atual::float8,
               p.estoque_minimo::float8,
               p.estoque_maximo::float8,
               p.venda_media_diaria::float8,
               p.preco_venda1::float8,
               d.descricao AS departamento
        FROM erp_produtos p
        LEFT JOIN erp_filiais f
          ON f.tenant_id = p.tenant_id AND f.erp_id = p.filial_erp_id
        LEFT JOIN erp_departamentos_n1 d
          ON d.tenant_id = p.tenant_id AND d.erp_id = p.dep1_erp_id
        WHERE p.ativo = true
          AND ${condicao}
          ${filtroCurva}
          ${recorte('p.filial_erp_id')}
        ORDER BY
          -- Curva A primeiro; dentro dela, quem tem menos dias de cobertura.
          CASE p.curva_abc WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END,
          CASE WHEN COALESCE(p.venda_media_diaria, 0) > 0
               THEN p.estoque_atual / p.venda_media_diaria
               ELSE 999999 END,
          p.descricao
        LIMIT ${params.itensPorPagina} OFFSET ${offset}`),

      await tx.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS total
        FROM erp_produtos p
        WHERE p.ativo = true
          AND ${condicao}
          ${filtroCurva}
          ${recorte('p.filial_erp_id')}`),
    ]);

    const contagem = contagens[0] ?? { ruptura: 0, negativo: 0, excesso: 0, curva_a: 0 };
    const quantidade = total[0]?.total ?? 0;

    const lista: ProdutoEstoqueView[] = produtos.map((linha) => {
      const media = Number(linha.venda_media_diaria ?? 0);
      const atual = Number(linha.estoque_atual ?? 0);

      return {
        erpId: linha.erp_id,
        descricao: linha.descricao,
        filialErpId: linha.filial_erp_id,
        filialNome: linha.nome ?? `Filial ${linha.filial_erp_id}`,
        curvaAbc: linha.curva_abc,
        estoqueAtual: atual,
        estoqueMinimo: Number(linha.estoque_minimo ?? 0),
        estoqueMaximo: linha.estoque_maximo === null ? null : Number(linha.estoque_maximo),
        vendaMediaDiaria: media,
        // Sem venda média não há cobertura: dizer "999 dias" seria inventar um número.
        coberturaDias: media > 0 ? atual / media : null,
        precoVenda: linha.preco_venda1 === null ? null : Number(linha.preco_venda1),
        departamento: linha.departamento,
      };
    });

    return {
      situacao: params.situacao,
      contagens: {
        ruptura: contagem.ruptura,
        negativo: contagem.negativo,
        excesso: contagem.excesso,
        curvaAEmRuptura: contagem.curva_a,
      },
      produtos: lista,
      paginacao: {
        pagina: params.pagina,
        itensPorPagina: params.itensPorPagina,
        total: quantidade,
        paginas: Math.max(1, Math.ceil(quantidade / params.itensPorPagina)),
      },
      frescor: await this.frescor.de(params.tenantId, 'produtos', null),
    };
  }
}
