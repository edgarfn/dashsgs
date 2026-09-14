import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { SgClient, SgError } from '../../../integration/sg';
import { TenantDatabase } from '../../../common/tenant';
import { type Coluna, upsertLote } from '../upsert-lote';
import { type ContextoSync, type JobDeSync, type ResultadoSync, somarDias } from '../sync.types';

/**
 * Compras: pedidos e notas de entrada (doc 14 §2 / E5-10 parcial).
 *
 * A janela é para trás, mas larga: pedido feito há 40 dias que só agora foi atendido precisa
 * voltar com a data de atendimento preenchida — é exatamente essa mudança que o lead time e o
 * "pendente antigo" enxergam (doc 15 §6).
 */

const DIAS_DE_JANELA = 60;

const COLUNAS_PEDIDO: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'erp_id', tipo: 'int' },
  { nome: 'filial_erp_id', tipo: 'int' },
  { nome: 'fornecedor_erp_id', tipo: 'int' },
  { nome: 'comprador_erp_id', tipo: 'int' },
  { nome: 'data_pedido', tipo: 'date' },
  { nome: 'data_previsao', tipo: 'date' },
  { nome: 'data_atendimento', tipo: 'date' },
  { nome: 'situacao', tipo: 'text' },
  { nome: 'valor_total', tipo: 'numeric' },
  { nome: 'valor_frete', tipo: 'numeric' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

const COLUNAS_ENTRADA: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'erp_id', tipo: 'int' },
  { nome: 'filial_erp_id', tipo: 'int' },
  { nome: 'fornecedor_erp_id', tipo: 'int' },
  { nome: 'numero', tipo: 'text' },
  { nome: 'serie', tipo: 'text' },
  { nome: 'data_emissao', tipo: 'date' },
  { nome: 'data_entrada', tipo: 'date' },
  { nome: 'valor_total', tipo: 'numeric' },
  { nome: 'situacao', tipo: 'text' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

@Injectable()
export class ComprasSync implements JobDeSync {
  readonly domain = 'compras' as const;

  constructor(
    private readonly sg: SgClient,
    private readonly tenantDb: TenantDatabase,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ComprasSync.name);
  }

  async executar(contexto: ContextoSync): Promise<ResultadoSync> {
    if (!contexto.data) throw new Error('compras exige o dia corrente do tenant');

    const janela = contexto.periodo ?? {
      inicio: somarDias(contexto.data, -DIAS_DE_JANELA),
      fim: contexto.data,
    };
    const agora = new Date();

    const [pedidos, entradas] = await Promise.all([
      this.pedidos(contexto, janela, agora),
      this.entradas(contexto, janela, agora),
    ]);

    return {
      items: (pedidos.items ?? 0) + (entradas.items ?? 0),
      invalid: (pedidos.invalid ?? 0) + (entradas.invalid ?? 0),
      apiCalls: (pedidos.apiCalls ?? 0) + (entradas.apiCalls ?? 0),
      pages: (pedidos.apiCalls ?? 0) + (entradas.apiCalls ?? 0),
      watermarkTs: agora,
    };
  }

  private async pedidos(
    contexto: ContextoSync,
    janela: { inicio: string; fim: string },
    agora: Date,
  ): Promise<ResultadoSync> {
    return this.comTolerancia('pedidos de compra', async () => {
      const coleta = await this.sg.getPedidosCompra(contexto.sg, {
        dataInicial: janela.inicio,
        dataFinal: janela.fim,
      });

      const items = await this.tenantDb.run(contexto.tenantId, (tx) =>
        upsertLote(
          tx,
          {
            tabela: 'erp_pedidos_compra',
            colunas: COLUNAS_PEDIDO,
            chave: ['tenant_id', 'erp_id'],
          },
          coleta.itens.map((pedido) => ({
            tenant_id: contexto.tenantId,
            erp_id: pedido.erpId,
            filial_erp_id: pedido.filialErpId,
            fornecedor_erp_id: pedido.fornecedorErpId,
            comprador_erp_id: pedido.compradorErpId,
            data_pedido: pedido.dataPedido,
            data_previsao: pedido.dataPrevisao,
            data_atendimento: pedido.dataAtendimento,
            situacao: pedido.situacao,
            valor_total: pedido.valorTotal,
            valor_frete: pedido.valorFrete,
            synced_at: agora,
          })),
        ),
      );

      return { items, invalid: coleta.invalidos, apiCalls: coleta.paginas ?? 1 };
    });
  }

  private async entradas(
    contexto: ContextoSync,
    janela: { inicio: string; fim: string },
    agora: Date,
  ): Promise<ResultadoSync> {
    return this.comTolerancia('notas de entrada', async () => {
      const coleta = await this.sg.getEntradas(contexto.sg, {
        dataInicial: janela.inicio,
        dataFinal: janela.fim,
      });

      const items = await this.tenantDb.run(contexto.tenantId, (tx) =>
        upsertLote(
          tx,
          { tabela: 'erp_notas_entrada', colunas: COLUNAS_ENTRADA, chave: ['tenant_id', 'erp_id'] },
          coleta.itens.map((nota) => ({
            tenant_id: contexto.tenantId,
            erp_id: nota.erpId,
            filial_erp_id: nota.filialErpId,
            fornecedor_erp_id: nota.fornecedorErpId,
            numero: nota.numero,
            serie: nota.serie,
            data_emissao: nota.dataEmissao,
            data_entrada: nota.dataEntrada,
            valor_total: nota.valorTotal,
            situacao: nota.situacao,
            synced_at: agora,
          })),
        ),
      );

      return { items, invalid: coleta.invalidos, apiCalls: coleta.paginas ?? 1 };
    });
  }

  private async comTolerancia(
    rotulo: string,
    executar: () => Promise<ResultadoSync>,
  ): Promise<ResultadoSync> {
    try {
      return await executar();
    } catch (erro) {
      if (
        erro instanceof SgError &&
        (erro.falha === 'rota_nao_contratada' || erro.falha === 'nao_encontrado')
      ) {
        this.logger.info({ event: 'compras_sem_contrato', recurso: rotulo }, 'compras');
        return {};
      }
      throw erro;
    }
  }
}
