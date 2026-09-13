import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { SgClient, SgError, type FiltroDataProduto } from '../../../integration/sg';
import { TenantDatabase } from '../../../common/tenant';
import { type Coluna, upsertLote } from '../upsert-lote';
import { WatermarkService } from '../watermark.service';
import { type ContextoSync, type JobDeSync, type ResultadoSync, somarDias } from '../sync.types';

/**
 * Produtos: cadastro, preço, custo e estoque (doc 14 §2) — a maior coleção do ERP.
 *
 * Três varreduras incrementais, não uma: a API tem três datas de alteração independentes
 * (cadastro, preço, custo) e um produto pode ter o preço mexido sem o cadastro mudar. Varrer só
 * por uma delas deixaria o dashboard com preço velho sem ninguém perceber.
 *
 * A marca d'água é recuada em um dia a cada ciclo (`SOBREPOSICAO_DIAS`). Parece desperdício, mas
 * a API filtra por **data**, não por instante: uma alteração feita depois da varredura de hoje,
 * ainda hoje, só apareceria amanhã — e amanhã a janela já teria passado.
 */

/** Dias de sobreposição na varredura incremental (a API filtra por data, não por timestamp). */
const SOBREPOSICAO_DIAS = 1;
/** Sem marca d'água (primeiro ciclo), varre o cadastro inteiro a partir desta data. */
const INICIO_PADRAO = '2000-01-01';

const FILTROS: FiltroDataProduto[] = [
  'dataAlteracaoCadastro',
  'dataAlteracaoPreco',
  'dataAlteracaoCusto',
];

const COLUNAS_PRODUTO: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'filial_erp_id', tipo: 'int' },
  { nome: 'erp_id', tipo: 'int' },
  { nome: 'descricao', tipo: 'text' },
  { nome: 'dep1_erp_id', tipo: 'text' },
  { nome: 'marca_erp_id', tipo: 'text' },
  { nome: 'classe_erp_id', tipo: 'text' },
  { nome: 'agrup_erp_id', tipo: 'text' },
  { nome: 'unidade_medida', tipo: 'text' },
  { nome: 'ativo', tipo: 'bool' },
  { nome: 'balanca', tipo: 'bool' },
  { nome: 'curva_abc', tipo: 'text' },
  { nome: 'custo_real', tipo: 'numeric' },
  { nome: 'custo_fiscal', tipo: 'numeric' },
  { nome: 'custo_com_encargos', tipo: 'numeric' },
  { nome: 'custo_medio', tipo: 'numeric' },
  { nome: 'preco_custo', tipo: 'numeric' },
  { nome: 'preco_venda1', tipo: 'numeric' },
  { nome: 'preco_venda2', tipo: 'numeric' },
  { nome: 'estoque_atual', tipo: 'numeric' },
  { nome: 'estoque_minimo', tipo: 'numeric' },
  { nome: 'estoque_maximo', tipo: 'numeric' },
  { nome: 'estoque_trocas', tipo: 'numeric' },
  { nome: 'venda_media_diaria', tipo: 'numeric' },
  { nome: 'data_cadastro', tipo: 'date' },
  { nome: 'data_alt_preco', tipo: 'date' },
  { nome: 'data_alt_custo', tipo: 'date' },
  { nome: 'data_alt_cadastro', tipo: 'date' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

const COLUNAS_GTIN: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'gtin', tipo: 'text' },
  { nome: 'produto_erp_id', tipo: 'int' },
  { nome: 'qtd_por_embalagem', tipo: 'numeric' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

@Injectable()
export class ProdutosSync implements JobDeSync {
  readonly domain = 'produtos' as const;

  constructor(
    private readonly sg: SgClient,
    private readonly tenantDb: TenantDatabase,
    private readonly watermarks: WatermarkService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProdutosSync.name);
  }

  async executar(contexto: ContextoSync): Promise<ResultadoSync> {
    const agora = new Date();
    const desde = contexto.data ?? (await this.inicioDaVarredura(contexto.tenantId));

    let items = 0;
    let invalid = 0;
    let apiCalls = 0;
    let pages = 0;

    for (const filtro of FILTROS) {
      const coleta = await this.sg.listProdutos(contexto.sg, {
        filtroDataTipo: filtro,
        dataAlteracaoInicial: desde,
      });
      apiCalls += coleta.paginas ?? 1;
      pages += coleta.paginas ?? 1;
      invalid += coleta.invalidos;

      items += await this.tenantDb.run(contexto.tenantId, (tx) =>
        upsertLote(
          tx,
          {
            tabela: 'erp_produtos',
            colunas: COLUNAS_PRODUTO,
            chave: ['tenant_id', 'filial_erp_id', 'erp_id'],
          },
          coleta.itens.map((produto) => ({
            tenant_id: contexto.tenantId,
            filial_erp_id: produto.filialErpId,
            erp_id: produto.erpId,
            descricao: produto.descricao,
            // Ids de dimensão viram texto: o ERP mistura número e código conforme o cadastro.
            dep1_erp_id: produto.dep1ErpId === null ? null : String(produto.dep1ErpId),
            marca_erp_id: produto.marcaErpId === null ? null : String(produto.marcaErpId),
            classe_erp_id: produto.classeErpId === null ? null : String(produto.classeErpId),
            agrup_erp_id: produto.agrupErpId === null ? null : String(produto.agrupErpId),
            unidade_medida: produto.unidadeMedida,
            ativo: produto.ativo,
            balanca: produto.balanca,
            curva_abc: produto.curvaAbc,
            custo_real: produto.custos.real,
            custo_fiscal: produto.custos.fiscal,
            custo_com_encargos: produto.custos.comEncargos,
            custo_medio: produto.custos.medio,
            preco_custo: produto.custos.precoCusto,
            preco_venda1: produto.precoVenda1,
            preco_venda2: produto.precoVenda2,
            estoque_atual: produto.estoqueAtual,
            estoque_minimo: produto.estoqueMinimo,
            estoque_maximo: produto.estoqueMaximo,
            estoque_trocas: produto.estoqueTrocas,
            venda_media_diaria: produto.vendaMediaDiaria,
            data_cadastro: produto.dataCadastro,
            data_alt_preco: produto.dataAlteracaoPreco,
            data_alt_custo: produto.dataAlteracaoCusto,
            data_alt_cadastro: produto.dataAlteracaoCadastro,
            synced_at: agora,
          })),
        ),
      );
    }

    const gtins = await this.sincronizarGtins(contexto, agora);
    items += gtins.items ?? 0;
    invalid += gtins.invalid ?? 0;
    apiCalls += gtins.apiCalls ?? 0;
    pages += gtins.pages ?? 0;

    return { items, invalid, apiCalls, pages, watermarkTs: agora };
  }

  /**
   * GTINs não têm data de alteração (doc 14 §2): a varredura é integral. Fora do contrato do
   * tenant, seguimos sem eles — o dashboard perde a busca por código de barras, não os dados.
   */
  private async sincronizarGtins(contexto: ContextoSync, agora: Date): Promise<ResultadoSync> {
    try {
      const coleta = await this.sg.listGtins(contexto.sg);

      const items = await this.tenantDb.run(contexto.tenantId, (tx) =>
        upsertLote(
          tx,
          { tabela: 'erp_gtins', colunas: COLUNAS_GTIN, chave: ['tenant_id', 'gtin'] },
          coleta.itens
            .filter((item) => item.gtin)
            .map((item) => ({
              tenant_id: contexto.tenantId,
              gtin: item.gtin,
              produto_erp_id: item.produtoErpId,
              qtd_por_embalagem: item.qtdPorEmbalagem,
              synced_at: agora,
            })),
        ),
      );

      return {
        items,
        invalid: coleta.invalidos,
        apiCalls: coleta.paginas ?? 1,
        pages: coleta.paginas ?? 1,
      };
    } catch (erro) {
      if (
        erro instanceof SgError &&
        (erro.falha === 'rota_nao_contratada' || erro.falha === 'nao_encontrado')
      ) {
        this.logger.info(
          { event: 'sync_gtins_sem_contrato', tenant_id: contexto.tenantId },
          'sync_gtins_sem_contrato',
        );
        return {};
      }
      throw erro;
    }
  }

  /** Onde recomeçar: um dia antes da última varredura boa, ou o começo de tudo na primeira vez. */
  private async inicioDaVarredura(tenantId: string): Promise<string> {
    const marca = await this.watermarks.obter(tenantId, this.domain);
    if (!marca?.watermarkTs) return INICIO_PADRAO;

    return somarDias(marca.watermarkTs.toISOString().slice(0, 10), -SOBREPOSICAO_DIAS);
  }
}
