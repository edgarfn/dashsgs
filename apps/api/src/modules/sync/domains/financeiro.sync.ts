import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { SgClient, SgError } from '../../../integration/sg';
import { TenantDatabase } from '../../../common/tenant';
import { AppConfigService } from '../../../config';
import { type Coluna, upsertLote } from '../upsert-lote';
import { WatermarkService } from '../watermark.service';
import { type ContextoSync, type JobDeSync, type ResultadoSync, somarDias } from '../sync.types';

/**
 * Financeiro: contas a pagar e a receber, despesas e cartões (doc 14 §2 / E5-09).
 *
 * A janela olha para **trás e para frente**, e é a única do produto que faz isso: o aging precisa
 * das parcelas que vencem nos próximos 90 dias, e a reconciliação precisa dos títulos emitidos
 * nos últimos dias — inclusive os que foram baixados depois de emitidos, que é o caso comum de
 * conta paga com atraso (doc 14 §4).
 */

/** Dias para trás: cobre lançamento retroativo e baixa posterior. */
const DIAS_PARA_TRAS = 45;
/** Dias para frente: o horizonte de fluxo de caixa que o painel mostra (doc 15 §5). */
const DIAS_PARA_FRENTE = 90;

const COLUNAS_CONTA: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'erp_id', tipo: 'int' },
  { nome: 'filial_erp_id', tipo: 'int' },
  { nome: 'documento', tipo: 'text' },
  { nome: 'data_emissao', tipo: 'date' },
  { nome: 'valor_total', tipo: 'numeric' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

const COLUNAS_PARCELA_PAGAR: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'conta_erp_id', tipo: 'int' },
  { nome: 'ordem', tipo: 'int' },
  { nome: 'data_vencimento', tipo: 'date' },
  { nome: 'data_pagamento', tipo: 'date' },
  { nome: 'valor_documento', tipo: 'numeric' },
  { nome: 'valor_pago', tipo: 'numeric' },
  { nome: 'saldo', tipo: 'numeric' },
  { nome: 'paga', tipo: 'bool' },
  { nome: 'tipo_lancamento', tipo: 'text' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

const COLUNAS_PARCELA_RECEBER: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'conta_erp_id', tipo: 'int' },
  { nome: 'ordem', tipo: 'int' },
  { nome: 'data_vencimento', tipo: 'date' },
  { nome: 'data_pagamento', tipo: 'date' },
  { nome: 'valor_documento', tipo: 'numeric' },
  { nome: 'valor_pago', tipo: 'numeric' },
  { nome: 'saldo', tipo: 'numeric' },
  { nome: 'juros', tipo: 'numeric' },
  { nome: 'desconto', tipo: 'numeric' },
  { nome: 'paga', tipo: 'bool' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

const COLUNAS_TIPO_DESPESA: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'erp_id', tipo: 'text' },
  { nome: 'descricao', tipo: 'text' },
  { nome: 'classificacao', tipo: 'text' },
  { nome: 'tipo_custo', tipo: 'text' },
  { nome: 'dep1_erp_id', tipo: 'text' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

const COLUNAS_DESPESA: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'filial_erp_id', tipo: 'int' },
  { nome: 'data_despesa', tipo: 'date' },
  { nome: 'sequencia', tipo: 'int' },
  { nome: 'tipo_despesa_erp_id', tipo: 'text' },
  { nome: 'fornecedor_erp_id', tipo: 'int' },
  { nome: 'data_emissao', tipo: 'date' },
  { nome: 'valor', tipo: 'numeric' },
  { nome: 'classificacao', tipo: 'text' },
  { nome: 'usuario_erp', tipo: 'text' },
  { nome: 'observacao', tipo: 'text' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

const COLUNAS_CARTAO: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'chave_venda', tipo: 'text' },
  { nome: 'filial_erp_id', tipo: 'int' },
  { nome: 'nsu', tipo: 'text' },
  { nome: 'data_venda', tipo: 'date' },
  { nome: 'data_vencimento', tipo: 'date' },
  { nome: 'valor_bruto', tipo: 'numeric' },
  { nome: 'taxa_pct', tipo: 'numeric' },
  { nome: 'tipo_venda', tipo: 'text' },
  { nome: 'forma_pagamento', tipo: 'text' },
  { nome: 'bandeira', tipo: 'text' },
  { nome: 'adquirente', tipo: 'text' },
  { nome: 'parcela', tipo: 'int' },
  { nome: 'baixada', tipo: 'bool' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

@Injectable()
export class FinanceiroSync implements JobDeSync {
  readonly domain = 'financeiro' as const;

  constructor(
    private readonly sg: SgClient,
    private readonly tenantDb: TenantDatabase,
    private readonly watermarks: WatermarkService,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FinanceiroSync.name);
  }

  async executar(contexto: ContextoSync): Promise<ResultadoSync> {
    if (!contexto.data) throw new Error('financeiro exige o dia corrente do tenant');

    const janela = contexto.periodo ?? {
      inicio: somarDias(contexto.data, -DIAS_PARA_TRAS),
      fim: somarDias(contexto.data, DIAS_PARA_FRENTE),
    };
    const agora = new Date();

    const partes = await Promise.all([
      this.contasPagar(contexto, janela, agora),
      this.contasReceber(contexto, janela, agora),
      this.despesas(contexto, janela, agora),
      this.cartoes(contexto, janela, agora),
    ]);

    const total = partes.reduce(
      (acumulado: { items: number; invalid: number; apiCalls: number }, parte) => ({
        items: acumulado.items + (parte.items ?? 0),
        invalid: acumulado.invalid + (parte.invalid ?? 0),
        apiCalls: acumulado.apiCalls + (parte.apiCalls ?? 0),
      }),
      { items: 0, invalid: 0, apiCalls: 0 },
    );

    return {
      ...total,
      pages: total.apiCalls,
      // A marca é o instante: o domínio não avança por dia fechado, e sim por varredura completa.
      watermarkTs: agora,
    };
  }

  private async contasPagar(
    contexto: ContextoSync,
    janela: { inicio: string; fim: string },
    agora: Date,
  ): Promise<ResultadoSync> {
    return this.comTolerancia('contas a pagar', async () => {
      const coleta = await this.sg.getContasPagar(contexto.sg, {
        dataInicial: janela.inicio,
        dataFinal: janela.fim,
      });

      const items = await this.tenantDb.run(contexto.tenantId, async (tx) => {
        const titulos = await upsertLote(
          tx,
          { tabela: 'erp_contas_pagar', colunas: COLUNAS_CONTA, chave: ['tenant_id', 'erp_id'] },
          coleta.itens.map((conta) => ({
            tenant_id: contexto.tenantId,
            erp_id: conta.erpId,
            filial_erp_id: conta.filialErpId,
            documento: conta.documento,
            data_emissao: conta.dataEmissao,
            valor_total: conta.valorTotal,
            synced_at: agora,
          })),
        );

        const parcelas = await upsertLote(
          tx,
          {
            tabela: 'erp_conta_pagar_parcelas',
            colunas: COLUNAS_PARCELA_PAGAR,
            chave: ['tenant_id', 'conta_erp_id', 'ordem'],
          },
          coleta.itens.flatMap((conta) =>
            conta.parcelas.map((parcela, indice) => ({
              tenant_id: contexto.tenantId,
              conta_erp_id: conta.erpId,
              ordem: parcela.ordem || indice + 1,
              data_vencimento: parcela.dataVencimento,
              data_pagamento: parcela.dataPagamento,
              valor_documento: parcela.valorDocumento,
              valor_pago: parcela.valorPago,
              saldo: parcela.saldo,
              paga: parcela.paga,
              tipo_lancamento: parcela.tipoLancamento,
              synced_at: agora,
            })),
          ),
        );

        return titulos + parcelas;
      });

      return { items, invalid: coleta.invalidos, apiCalls: coleta.paginas ?? 1 };
    });
  }

  private async contasReceber(
    contexto: ContextoSync,
    janela: { inicio: string; fim: string },
    agora: Date,
  ): Promise<ResultadoSync> {
    return this.comTolerancia('contas a receber', async () => {
      const coleta = await this.sg.getContasReceber(contexto.sg, {
        dataInicial: janela.inicio,
        dataFinal: janela.fim,
      });

      // O módulo Clientes desligado (padrão) significa não guardar o id do cliente (doc 10 §1):
      // o aging não precisa saber de quem é o título, só quanto e quando.
      const guardarCliente = this.config.features.clientModule;

      const items = await this.tenantDb.run(contexto.tenantId, async (tx) => {
        const titulos = await upsertLote(
          tx,
          {
            tabela: 'erp_contas_receber',
            colunas: [...COLUNAS_CONTA, { nome: 'cliente_erp_id', tipo: 'int' }],
            chave: ['tenant_id', 'erp_id'],
          },
          coleta.itens.map((conta) => ({
            tenant_id: contexto.tenantId,
            erp_id: conta.erpId,
            filial_erp_id: conta.filialErpId,
            cliente_erp_id: guardarCliente ? conta.clienteErpId : null,
            documento: conta.documento,
            data_emissao: conta.dataEmissao,
            valor_total: conta.valorTotal,
            synced_at: agora,
          })),
        );

        const parcelas = await upsertLote(
          tx,
          {
            tabela: 'erp_conta_receber_parcelas',
            colunas: COLUNAS_PARCELA_RECEBER,
            chave: ['tenant_id', 'conta_erp_id', 'ordem'],
          },
          coleta.itens.flatMap((conta) =>
            conta.parcelas.map((parcela, indice) => ({
              tenant_id: contexto.tenantId,
              conta_erp_id: conta.erpId,
              ordem: parcela.ordem || indice + 1,
              data_vencimento: parcela.dataVencimento,
              data_pagamento: parcela.dataPagamento,
              valor_documento: parcela.valorDocumento,
              valor_pago: parcela.valorPago,
              saldo: parcela.saldo,
              juros: parcela.juros,
              desconto: parcela.desconto,
              paga: parcela.paga,
              synced_at: agora,
            })),
          ),
        );

        return titulos + parcelas;
      });

      return { items, invalid: coleta.invalidos, apiCalls: coleta.paginas ?? 1 };
    });
  }

  private async despesas(
    contexto: ContextoSync,
    janela: { inicio: string; fim: string },
    agora: Date,
  ): Promise<ResultadoSync> {
    return this.comTolerancia('despesas', async () => {
      const tipos = await this.sg.listTiposDespesa(contexto.sg);
      const coleta = await this.sg.getDespesas(contexto.sg, {
        dataInicial: janela.inicio,
        // Despesa é lançamento passado: pedir o futuro só gastaria chamada.
        dataFinal: contexto.data as string,
      });

      const items = await this.tenantDb.run(contexto.tenantId, async (tx) => {
        const dimensao = await upsertLote(
          tx,
          {
            tabela: 'erp_tipos_despesa',
            colunas: COLUNAS_TIPO_DESPESA,
            chave: ['tenant_id', 'erp_id'],
          },
          tipos.itens.map((tipo) => ({
            tenant_id: contexto.tenantId,
            erp_id: tipo.erpId,
            descricao: tipo.descricao,
            classificacao: tipo.classificacao,
            tipo_custo: tipo.tipoCusto,
            dep1_erp_id: tipo.dep1ErpId,
            synced_at: agora,
          })),
        );

        const lancamentos = await upsertLote(
          tx,
          {
            tabela: 'erp_despesas',
            colunas: COLUNAS_DESPESA,
            chave: ['tenant_id', 'filial_erp_id', 'data_despesa', 'sequencia'],
          },
          coleta.itens.map((despesa) => ({
            tenant_id: contexto.tenantId,
            filial_erp_id: despesa.filialErpId,
            data_despesa: despesa.dataDespesa,
            sequencia: despesa.sequencia,
            tipo_despesa_erp_id: despesa.tipoDespesaErpId,
            fornecedor_erp_id: despesa.fornecedorErpId,
            data_emissao: despesa.dataEmissao,
            valor: despesa.valor,
            classificacao: despesa.classificacao,
            usuario_erp: despesa.usuarioErp,
            observacao: despesa.observacao,
            synced_at: agora,
          })),
        );

        return dimensao + lancamentos;
      });

      return {
        items,
        invalid: tipos.invalidos + coleta.invalidos,
        apiCalls: 1 + (coleta.paginas ?? 1),
      };
    });
  }

  private async cartoes(
    contexto: ContextoSync,
    janela: { inicio: string; fim: string },
    agora: Date,
  ): Promise<ResultadoSync> {
    return this.comTolerancia('cartões', async () => {
      const coleta = await this.sg.getCartoes(contexto.sg, {
        dataInicial: janela.inicio,
        dataFinal: contexto.data as string,
      });

      const items = await this.tenantDb.run(contexto.tenantId, (tx) =>
        upsertLote(
          tx,
          {
            tabela: 'erp_cartao_vendas',
            colunas: COLUNAS_CARTAO,
            chave: ['tenant_id', 'chave_venda'],
          },
          coleta.itens.map((cartao) => ({
            tenant_id: contexto.tenantId,
            chave_venda: cartao.chaveVenda,
            filial_erp_id: cartao.filialErpId,
            nsu: cartao.nsu,
            data_venda: cartao.dataVenda,
            data_vencimento: cartao.dataVencimento,
            valor_bruto: cartao.valorBruto,
            taxa_pct: cartao.taxaPct,
            tipo_venda: cartao.tipoVenda,
            forma_pagamento: cartao.formaPagamento,
            bandeira: cartao.bandeira,
            adquirente: cartao.adquirente,
            parcela: cartao.parcela,
            baixada: cartao.baixada,
            synced_at: agora,
          })),
        ),
      );

      return { items, invalid: coleta.invalidos, apiCalls: coleta.paginas ?? 1 };
    });
  }

  /**
   * Recurso fora do contrato não derruba o domínio inteiro (doc 12 §2/§8).
   *
   * Uma rede que não contratou o módulo financeiro completo pode ter contas a pagar e não ter
   * cartões — e é melhor entregar metade do painel do que nenhuma.
   */
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
        this.logger.info({ event: 'financeiro_sem_contrato', recurso: rotulo }, 'financeiro');
        return {};
      }
      throw erro;
    }
  }
}
