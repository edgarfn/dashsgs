import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type SgFinalizadora, type SgVendaCupom } from '../../../integration/sg';
import { AppConfigService } from '../../../config';
import { TenantDatabase } from '../../../common/tenant';
import { AggregatesService } from '../aggregates.service';
import { type Coluna, inserirLote } from '../upsert-lote';

const COLUNAS_CUPOM: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'filial_erp_id', tipo: 'int' },
  { nome: 'data', tipo: 'date' },
  { nome: 'caixa', tipo: 'int' },
  { nome: 'cupom', tipo: 'int' },
  { nome: 'serie_nfc', tipo: 'text' },
  { nome: 'horario', tipo: 'text' },
  { nome: 'cliente_erp_id', tipo: 'int' },
  { nome: 'identificada', tipo: 'bool' },
  { nome: 'vendedor_erp_id', tipo: 'int' },
  { nome: 'cancelada', tipo: 'bool' },
  { nome: 'valor_total', tipo: 'numeric' },
  { nome: 'is_realtime', tipo: 'bool' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

const COLUNAS_ITEM: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'filial_erp_id', tipo: 'int' },
  { nome: 'data', tipo: 'date' },
  { nome: 'caixa', tipo: 'int' },
  { nome: 'cupom', tipo: 'int' },
  { nome: 'ordem', tipo: 'int' },
  { nome: 'produto_erp_id', tipo: 'int' },
  { nome: 'gtin', tipo: 'text' },
  { nome: 'quantidade', tipo: 'numeric' },
  { nome: 'preco_venda', tipo: 'numeric' },
  { nome: 'desconto', tipo: 'numeric' },
  { nome: 'acrescimo', tipo: 'numeric' },
  { nome: 'cancelado', tipo: 'bool' },
  { nome: 'oferta_erp_id', tipo: 'text' },
  { nome: 'pedido_venda_erp_id', tipo: 'int' },
  { nome: 'icms_base', tipo: 'numeric' },
  { nome: 'icms_aliq', tipo: 'numeric' },
  { nome: 'icms_valor', tipo: 'numeric' },
  { nome: 'pis_base', tipo: 'numeric' },
  { nome: 'cofins_base', tipo: 'numeric' },
  { nome: 'tipo_tributacao', tipo: 'text' },
  { nome: 'modelo_doc', tipo: 'text' },
  { nome: 'is_realtime', tipo: 'bool' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

const COLUNAS_FINALIZADORA: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'filial_erp_id', tipo: 'int' },
  { nome: 'data', tipo: 'date' },
  { nome: 'caixa', tipo: 'int' },
  { nome: 'cupom', tipo: 'int' },
  { nome: 'ordem', tipo: 'int' },
  { nome: 'especie', tipo: 'text' },
  { nome: 'valor', tipo: 'numeric' },
  { nome: 'cancelada', tipo: 'bool' },
  { nome: 'is_realtime', tipo: 'bool' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

export interface ResultadoPersistencia {
  cupons: number;
  itens: number;
  finalizadoras: number;
}

/**
 * Gravação de um dia de vendas de uma filial — a parte mais delicada do sync.
 *
 * Estratégia: **apagar o dia e reescrever**, numa transação só. Não é preguiça de fazer diff —
 * é o que mantém o espelho igual ao ERP: cupom estornado some do ERP e precisa sumir daqui, e um
 * upsert cego deixaria o fantasma para trás inflando o faturamento do dia.
 *
 * O mesmo caminho serve para o tempo real (`isRealtime = true`) e para a consolidação do dia
 * fechado (`false`), e é isso que torna a consolidação trivial: ela apaga o provisório junto com
 * o resto e grava o definitivo no lugar (doc 14 §2).
 */
@Injectable()
export class VendasPersistencia {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly aggregates: AggregatesService,
    private readonly config: AppConfigService,
  ) {}

  async gravarDia(params: {
    tenantId: string;
    filialErpId: number;
    data: string;
    cupons: SgVendaCupom[];
    finalizadoras: SgFinalizadora[];
    isRealtime: boolean;
  }): Promise<ResultadoPersistencia> {
    const agora = new Date();
    const { tenantId, filialErpId, data, isRealtime } = params;

    // O id do cliente só entra no banco com o módulo Clientes ligado (doc 10 §1). Sem ele, a
    // venda continua sabendo que foi identificada — o que basta para taxa de fidelização.
    const guardarCliente = this.config.features.clientModule;

    const linhasCupom = params.cupons.map((cupom) => ({
      tenant_id: tenantId,
      filial_erp_id: filialErpId,
      data,
      caixa: cupom.caixa,
      cupom: cupom.cupom,
      serie_nfc: cupom.serieNfc,
      horario: cupom.horario,
      cliente_erp_id: guardarCliente ? cupom.clienteErpId : null,
      identificada: cupom.identificada,
      vendedor_erp_id: cupom.vendedorErpId,
      cancelada: cupom.cancelada,
      valor_total: cupom.valorTotal,
      is_realtime: isRealtime,
      synced_at: agora,
    }));

    const linhasItem = params.cupons.flatMap((cupom) =>
      cupom.itens.map((item, indice) => ({
        tenant_id: tenantId,
        filial_erp_id: filialErpId,
        data,
        caixa: cupom.caixa,
        cupom: cupom.cupom,
        // `ordem` vem do ERP quando existe; o índice é a rede de segurança contra ordem repetida.
        ordem: item.ordem || indice + 1,
        produto_erp_id: item.produtoErpId,
        gtin: item.gtin,
        quantidade: item.quantidade,
        preco_venda: item.precoVenda,
        desconto: item.desconto,
        acrescimo: item.acrescimo,
        cancelado: item.cancelado,
        oferta_erp_id: item.ofertaErpId,
        pedido_venda_erp_id: item.pedidoVendaErpId,
        icms_base: item.icmsBase,
        icms_aliq: item.icmsAliq,
        icms_valor: item.icmsValor,
        pis_base: item.pisBase,
        cofins_base: item.cofinsBase,
        tipo_tributacao: item.tipoTributacao,
        modelo_doc: item.modeloDoc,
        is_realtime: isRealtime,
        synced_at: agora,
      })),
    );

    // Dois itens do mesmo cupom com a mesma ordem existem no ERP (correções de caixa). Como a PK
    // não admite, a segunda ocorrência recebe a próxima ordem livre em vez de derrubar o dia.
    const vistos = new Set<string>();
    for (const linha of linhasItem) {
      let ordem = linha.ordem;
      while (vistos.has(`${linha.caixa}:${linha.cupom}:${ordem}`)) ordem += 1;
      linha.ordem = ordem;
      vistos.add(`${linha.caixa}:${linha.cupom}:${ordem}`);
    }

    const porCupom = new Map<string, number>();
    const linhasFinalizadora = params.finalizadoras.map((lancamento) => {
      const chave = `${lancamento.caixa}:${lancamento.cupom}`;
      const ordem = (porCupom.get(chave) ?? 0) + 1;
      porCupom.set(chave, ordem);

      return {
        tenant_id: tenantId,
        filial_erp_id: filialErpId,
        data,
        caixa: lancamento.caixa,
        cupom: lancamento.cupom,
        ordem,
        especie: lancamento.especie,
        valor: lancamento.valor,
        cancelada: lancamento.cancelada,
        is_realtime: isRealtime,
        synced_at: agora,
      };
    });

    await this.tenantDb.run(tenantId, async (tx) => {
      const alvo = Prisma.sql`
        tenant_id = ${tenantId}::uuid
        AND filial_erp_id = ${filialErpId}::int
        AND data = ${data}::date`;

      await tx.$executeRaw(Prisma.sql`DELETE FROM erp_venda_itens WHERE ${alvo}`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM erp_vendas_cupons WHERE ${alvo}`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM erp_finalizadora_lancamentos WHERE ${alvo}`);

      await inserirLote(tx, { tabela: 'erp_vendas_cupons', colunas: COLUNAS_CUPOM }, linhasCupom);
      await inserirLote(tx, { tabela: 'erp_venda_itens', colunas: COLUNAS_ITEM }, linhasItem);
      await inserirLote(
        tx,
        { tabela: 'erp_finalizadora_lancamentos', colunas: COLUNAS_FINALIZADORA },
        linhasFinalizadora,
      );

      // Agregados na mesma transação: ou o dia inteiro muda, ou nada muda. Um agregado que
      // sobrevive ao rollback do fato vira número errado na tela, e ninguém desconfia dele.
      await this.aggregates.recalcularNaTransacao(tx, tenantId, filialErpId, data);
    });

    return {
      cupons: linhasCupom.length,
      itens: linhasItem.length,
      finalizadoras: linhasFinalizadora.length,
    };
  }
}
