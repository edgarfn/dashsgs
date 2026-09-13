import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDatabase } from '../../common/tenant';
import { type PrismaTransaction } from '../../common/prisma/prisma.service';

/**
 * Agregados do dashboard (doc 05 §3 / E5-08).
 *
 * Recalculados **por evento de sync**, nunca no caminho do request: o dashboard tem orçamento de
 * 300 ms (doc 04 §3.1) e somar cupom por cupom na hora não cabe nele. O recálculo é sempre o dia
 * inteiro de uma filial — refazer um dia é barato e dispensa saber o que mudou dentro dele.
 *
 * Toda instrução roda dentro da transação do chamador, com `app.tenant_id` já fixado: o `INSERT
 * ... SELECT` lê o espelho pela RLS, então não há como um tenant agregar o fato de outro.
 */
@Injectable()
export class AggregatesService {
  constructor(private readonly tenantDb: TenantDatabase) {}

  /** Recalcula os dois agregados de venda de um (filial, dia). */
  async recalcularDia(tenantId: string, filialErpId: number, data: string): Promise<void> {
    await this.tenantDb.run(tenantId, async (tx) => {
      await this.recalcularNaTransacao(tx, tenantId, filialErpId, data);
    });
  }

  async recalcularNaTransacao(
    tx: PrismaTransaction,
    tenantId: string,
    filialErpId: number,
    data: string,
  ): Promise<void> {
    await this.vendasPorHora(tx, tenantId, filialErpId, data);
    await this.vendasPorDepartamento(tx, tenantId, filialErpId, data);
  }

  /**
   * Curva do dia (doc 15 §3). Cupom cancelado não entra: ele existe no espelho para auditoria,
   * mas não é venda.
   *
   * Cupom sem horário cai na hora 0 — a alternativa seria descartá-lo, e aí a soma das horas não
   * bateria com o total do dia, que é o primeiro número que o dono da loja confere.
   */
  private async vendasPorHora(
    tx: PrismaTransaction,
    tenantId: string,
    filialErpId: number,
    data: string,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM agg_vendas_hora
      WHERE tenant_id = ${tenantId}::uuid
        AND filial_erp_id = ${filialErpId}::int
        AND data = ${data}::date`);

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO agg_vendas_hora (tenant_id, filial_erp_id, data, hora, valor, cupons, itens, updated_at)
      SELECT
        c.tenant_id,
        c.filial_erp_id,
        c.data,
        COALESCE(NULLIF(SPLIT_PART(c.horario, ':', 1), '')::int, 0) AS hora,
        SUM(c.valor_total) AS valor,
        COUNT(*)::int AS cupons,
        COALESCE(SUM(i.quantidade), 0) AS itens,
        NOW() AS updated_at
      FROM erp_vendas_cupons c
      LEFT JOIN LATERAL (
        SELECT SUM(it.quantidade) AS quantidade
        FROM erp_venda_itens it
        WHERE it.tenant_id = c.tenant_id
          AND it.filial_erp_id = c.filial_erp_id
          AND it.data = c.data
          AND it.caixa = c.caixa
          AND it.cupom = c.cupom
          AND it.cancelado = false
      ) i ON TRUE
      WHERE c.tenant_id = ${tenantId}::uuid
        AND c.filial_erp_id = ${filialErpId}::int
        AND c.data = ${data}::date
        AND c.cancelada = false
      GROUP BY c.tenant_id, c.filial_erp_id, c.data, hora`);
  }

  /**
   * Venda e margem por departamento nível 1 (doc 15 §4).
   *
   * O custo vem do cadastro **atual** do produto, não de um custo histórico: a API não entrega o
   * custo praticado no momento da venda, e inventar um seria pior que assumir esta limitação —
   * que está registrada no doc 33 e aparece como nota na tela.
   */
  private async vendasPorDepartamento(
    tx: PrismaTransaction,
    tenantId: string,
    filialErpId: number,
    data: string,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM agg_vendas_dia_dep
      WHERE tenant_id = ${tenantId}::uuid
        AND filial_erp_id = ${filialErpId}::int
        AND data = ${data}::date`);

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO agg_vendas_dia_dep
        (tenant_id, filial_erp_id, data, dep1_erp_id, valor, quantidade, custo, margem, updated_at)
      SELECT
        i.tenant_id,
        i.filial_erp_id,
        i.data,
        COALESCE(p.dep1_erp_id, '(sem departamento)') AS dep1_erp_id,
        SUM(i.quantidade * i.preco_venda - i.desconto + i.acrescimo) AS valor,
        SUM(i.quantidade) AS quantidade,
        SUM(i.quantidade * COALESCE(p.custo_medio, p.custo_real, 0)) AS custo,
        SUM(i.quantidade * i.preco_venda - i.desconto + i.acrescimo)
          - SUM(i.quantidade * COALESCE(p.custo_medio, p.custo_real, 0)) AS margem,
        NOW() AS updated_at
      FROM erp_venda_itens i
      LEFT JOIN erp_produtos p
        ON p.tenant_id = i.tenant_id
       AND p.filial_erp_id = i.filial_erp_id
       AND p.erp_id = i.produto_erp_id
      WHERE i.tenant_id = ${tenantId}::uuid
        AND i.filial_erp_id = ${filialErpId}::int
        AND i.data = ${data}::date
        AND i.cancelado = false
      GROUP BY i.tenant_id, i.filial_erp_id, i.data, COALESCE(p.dep1_erp_id, '(sem departamento)')`);
  }
}
