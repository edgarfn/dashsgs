import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AppConfigService } from '../../config';
import { SgHttpClient, type SgConnectionContext } from './http/sg-http.client';
import { type PrioridadeChamada } from './http/sg-rate-limiter';
import { normalizarPagina } from './normalizers';
import { SgError } from './sg-errors';
import { SgTokenManager } from './sg-token.manager';
import {
  cartaoVendaSchema,
  contaPagarSchema,
  contaReceberSchema,
  despesaSchema,
  dimensaoSchema,
  filialSchema,
  gtinSchema,
  notaEntradaSchema,
  pedidoCompraSchema,
  previsaoVendasSchema,
  previsaoVendasDiariaSchema,
  tipoDespesaSchema,
  finalizadoraSchema,
  produtoSchema,
  resumoFilialSchema,
  statusSchema,
  vendaCupomSchema,
  type SgDimensao,
  type SgCartaoVenda,
  type SgContaPagar,
  type SgContaReceber,
  type SgDespesa,
  type SgFilial,
  type SgFinalizadora,
  type SgGtin,
  type SgNotaEntrada,
  type SgPedidoCompra,
  type SgPrevisaoVendas,
  type SgPrevisaoVendasDiaria,
  type SgTipoDespesa,
  type SgProduto,
  type SgResumoFilial,
  type SgStatus,
  type SgVendaCupom,
} from './types';

const BASE = '/integracao/sgsistemas/v1';

/**
 * Teto de `itensPorPagina` por rota — a resposta que a SG ainda não deu (doc 34 Q4).
 *
 * Cada entrada aqui é uma **suposição**, não um fato documentado: o valor foi o que se observou
 * aguentar na homologação. Estava antes escrito como número solto no meio de uma chamada, onde
 * ninguém o encontrava nem sabia de onde vinha. Aqui ele tem nome, motivo e um lugar para a
 * resposta verdadeira entrar quando chegar — e o tenant ainda pode sobrescrever cada linha.
 */
const TETO_POR_ROTA: Record<string, number> = {
  // Resumo diário por filial: a página grande estourava o tempo do lado do ERP.
  'GET /filiais/vendas': 200,
};

/** Recorte máximo aceito pela API em séries históricas (doc 03 / doc 12 §3). */
export const JANELA_MAXIMA_DIAS = 30;

export interface SgCallContext {
  conexao: SgConnectionContext & {
    isSgCloud: boolean;
    authPathOverride?: string | null;
    /** Claim `routes` do último token — o contrato real deste tenant com a SG. */
    routesGranted: string[];
    /** Itens por página deste tenant; ausente = padrão da instalação (doc 34 Q4). */
    pageSize?: number | null;
    /** Teto por rota já confirmado pela própria API, ex.: `{"GET /vendas": 100}`. */
    pageSizePorRota?: Record<string, number> | null;
  };
  credenciais: () => Promise<{ usuario: string; senha: string }>;
  prioridade?: PrioridadeChamada;
  /**
   * Grava no cadastro do tenant o que o cliente descobriu sozinho em execução (doc 34 Q2/Q4).
   *
   * É porta, como `credenciais`: a camada de integração não conhece banco. Quem implementa é o
   * `ErpConnectionService`, que é dono da conexão. Sem isto, a descoberta vive só no cache do
   * token (50 min) e se perde a cada renovação — cada ciclo pagaria de novo o 401 de aprendizado.
   */
  aprender?: (ajuste: AprendizadoDaConexao) => Promise<void>;
}

/** O que o cliente aprende conversando com a instalação, e que vale guardar. */
export interface AprendizadoDaConexao {
  /** Formato do header Authorization que a instalação de fato aceita (doc 34 Q2). */
  authHeaderMode?: 'raw' | 'bearer';
  /** Teto de `itensPorPagina` que a rota aceitou, por rota (doc 34 Q4). */
  pageSizePorRota?: Record<string, number>;
}

export interface ResultadoColeta<T> {
  itens: T[];
  /** Itens que não bateram com o schema: seguem para quarentena, sem abortar a página. */
  invalidos: number;
  /** Páginas percorridas — entra no histórico da execução de sync (doc 05 §2). */
  paginas?: number;
}

/** Qual das três datas de alteração o filtro de /produtos usa (doc 14 §2). */
export type FiltroDataProduto =
  'dataAlteracaoCadastro' | 'dataAlteracaoPreco' | 'dataAlteracaoCusto';

/**
 * Catálogo tipado de operações da API SG (doc 12 §5) — a camada anticorrupção propriamente dita.
 *
 * Quem chama daqui para cima nunca vê envelope inconsistente, char-flag, data vazia nem 400 que
 * na verdade significa "não encontrei". Vê listas de objetos limpos, ou um erro classificado.
 *
 * Cobertura desta fase: status, filiais, dimensões, produtos, vendas (dia e tempo real),
 * finalizadoras e resumo diário — o conjunto que a Fase 6 sincroniza primeiro. Cada operação
 * nova segue o mesmo molde e o passo-a-passo do doc 24 §7.
 */
@Injectable()
export class SgClient {
  constructor(
    private readonly http: SgHttpClient,
    private readonly tokens: SgTokenManager,
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SgClient.name);
  }

  // ---------------------------------------------------------------- health
  /** `GET /sgsistemas/v1/status` — versão do ERP e filial base; usado no health-check. */
  async getStatus(contexto: SgCallContext): Promise<SgStatus> {
    const corpo = await this.get(contexto, '/sgsistemas/v1/status', {}, 'GET /status');
    const parsed = statusSchema.safeParse(corpo);
    if (!parsed.success) {
      throw new SgError('resposta_invalida', { endpoint: '/status' });
    }
    return parsed.data;
  }

  // ---------------------------------------------------------------- dimensões
  async listFiliais(contexto: SgCallContext): Promise<ResultadoColeta<SgFilial>> {
    const corpo = await this.get(contexto, `${BASE}/filiais`, {}, 'GET /filiais');
    return this.coletar(
      contexto,
      filialSchema,
      normalizarPagina(corpo, 'filiais').itens,
      'filiais',
    );
  }

  /** Departamentos (6 níveis), marcas, classes e agrupamentos compartilham o formato id+descrição. */
  async listDimensao(
    contexto: SgCallContext,
    recurso:
      | 'marcas'
      | 'classes'
      | 'agrupamentos'
      | 'unidadesmedida'
      | 'departamentos/nivel1'
      | 'departamentos/nivel2'
      | 'departamentos/nivel3'
      | 'departamentos/nivel4'
      | 'departamentos/nivel5'
      | 'departamentos/nivel6',
  ): Promise<ResultadoColeta<SgDimensao>> {
    const corpo = await this.get(contexto, `${BASE}/${recurso}`, {}, `GET /${recurso}`);
    return this.coletar(contexto, dimensaoSchema, normalizarPagina(corpo).itens, recurso);
  }

  // ---------------------------------------------------------------- produtos
  async listProdutos(
    contexto: SgCallContext,
    filtro: {
      filial?: number;
      /**
       * Varredura incremental: a API tem três datas de alteração (cadastro, preço, custo) e um
       * seletor para dizer qual delas o filtro usa (doc 14 §2). Sem isso, cada ciclo baixaria o
       * cadastro inteiro — e o cadastro é a maior coleção do ERP.
       */
      filtroDataTipo?: FiltroDataProduto;
      dataAlteracaoInicial?: string;
      dataAlteracaoFinal?: string;
      itensPorPagina?: number;
    } = {},
  ): Promise<ResultadoColeta<SgProduto>> {
    const itens: SgProduto[] = [];
    let invalidos = 0;
    let paginas = 0;

    for await (const pagina of this.paginar(
      contexto,
      `${BASE}/produtos`,
      {
        filial: filtro.filial,
        filtroDataTipo: filtro.filtroDataTipo,
        dataAlteracaoInicial: filtro.dataAlteracaoInicial,
        dataAlteracaoFinal: filtro.dataAlteracaoFinal,
      },
      'GET /produtos',
      {
        itensPorPagina: filtro.itensPorPagina,
        chaveItens: 'produtos',
      },
    )) {
      paginas += 1;
      const coleta = await this.coletar(contexto, produtoSchema, pagina, 'produtos');
      itens.push(...coleta.itens);
      invalidos += coleta.invalidos;
    }

    return { itens, invalidos, paginas };
  }

  /**
   * Códigos de barras. Não há data de alteração aqui (doc 14 §2): a varredura é integral, em
   * cadência diária — é o preço de a API não expor delta para este recurso.
   */
  async listGtins(
    contexto: SgCallContext,
    filtro: { produto?: number; itensPorPagina?: number } = {},
  ): Promise<ResultadoColeta<SgGtin>> {
    const itens: SgGtin[] = [];
    let invalidos = 0;
    let paginas = 0;

    for await (const pagina of this.paginar(
      contexto,
      `${BASE}/produtos/gtins`,
      { idProduto: filtro.produto },
      'GET /produtos/gtins',
      {
        itensPorPagina: filtro.itensPorPagina,
        chaveItens: 'gtins',
        prioridade: 'backfill',
      },
    )) {
      paginas += 1;
      const coleta = await this.coletar(contexto, gtinSchema, pagina, 'gtins');
      itens.push(...coleta.itens);
      invalidos += coleta.invalidos;
    }

    return { itens, invalidos, paginas };
  }

  // ---------------------------------------------------------------- vendas
  /**
   * Vendas do dia fechado. A API exige **filial e data únicas** (doc 03) — uma chamada por
   * dia × filial, e é por isso que o backfill da Fase 6 precisa de paralelismo calibrado.
   */
  async getVendasDia(
    contexto: SgCallContext,
    params: { filial: number; data: string; emitePisCofins?: boolean },
  ): Promise<ResultadoColeta<SgVendaCupom>> {
    const corpo = await this.get(
      contexto,
      `${BASE}/vendas`,
      {
        filial: params.filial,
        data: params.data,
        emitePISCOFINS: params.emitePisCofins ? 'true' : undefined,
      },
      'GET /vendas',
      { pesado: params.emitePisCofins === true },
    );

    return this.coletar(
      contexto,
      vendaCupomSchema,
      normalizarPagina(corpo, 'vendas').itens,
      'vendas',
    );
  }

  /** Vendas do dia corrente (provisórias até o fechamento — doc 02 §7.6). */
  async getVendasHoje(
    contexto: SgCallContext,
    params: { filial: number },
  ): Promise<ResultadoColeta<SgVendaCupom>> {
    const corpo = await this.get(
      contexto,
      `${BASE}/vendas/hoje`,
      { filial: params.filial },
      'GET /vendas/hoje',
      { prioridade: 'tempo-real' },
    );

    return this.coletar(
      contexto,
      vendaCupomSchema,
      normalizarPagina(corpo, 'vendas').itens,
      'vendas_hoje',
    );
  }

  async getFinalizadoras(
    contexto: SgCallContext,
    params: { filial: number; data?: string; hoje?: boolean },
  ): Promise<ResultadoColeta<SgFinalizadora>> {
    // A rota "hoje" é uma FILHA de /vendas/finalizadoras, não uma irmã — a documentação da SG
    // (Postman: "Vendas / Finalizadoras Hoje") mostra `/vendas/finalizadoras/hoje`. Faltava o
    // segmento `/vendas` aqui; o mock nunca acusou porque casa por `endsWith('/finalizadoras/hoje')`,
    // que aceita o caminho certo e o errado igualmente — só o servidor real, que confere o
    // caminho inteiro, devolve 404 pra essa diferença (doc 34 §4.7).
    const caminho = params.hoje
      ? `${BASE}/vendas/finalizadoras/hoje`
      : `${BASE}/vendas/finalizadoras`;
    const corpo = await this.get(
      contexto,
      caminho,
      { filial: params.filial, data: params.data },
      `GET ${caminho.replace(BASE, '')}`,
      { prioridade: params.hoje ? 'tempo-real' : 'backfill' },
    );

    return this.coletar(
      contexto,
      finalizadoraSchema,
      normalizarPagina(corpo, 'finalizadoras').itens,
      'finalizadoras',
    );
  }

  /**
   * Resumo diário por filial — janela documentada de 30 dias (doc 03).
   *
   * O parâmetro é `filial` (singular), como em toda rota deste cliente que recorta por filial —
   * apesar do caminho `/filiais/vendas` ser plural. Enviar `filiais` (array) fazia a API real
   * devolver 400 "Parametros obrigatorios nao informados: filial", que o mock nunca acusava
   * porque casa a rota só pelo caminho, sem olhar a query (doc 34 §4.7 — ficou em aberto até a
   * homologação real revelar o corpo do 400).
   */
  async getResumoFilial(
    contexto: SgCallContext,
    params: { filial: number; dataInicial: string; dataFinal: string },
  ): Promise<ResultadoColeta<SgResumoFilial>> {
    assertJanela(params.dataInicial, params.dataFinal);

    const itens: SgResumoFilial[] = [];
    let invalidos = 0;

    for await (const pagina of this.paginar(
      contexto,
      `${BASE}/filiais/vendas`,
      {
        filial: params.filial,
        dataInicial: params.dataInicial,
        dataFinal: params.dataFinal,
      },
      'GET /filiais/vendas',
      { chaveItens: 'vendas', prioridade: 'backfill' },
    )) {
      const coleta = await this.coletar(contexto, resumoFilialSchema, pagina, 'resumo_filial');
      itens.push(...coleta.itens);
      invalidos += coleta.invalidos;
    }

    return { itens, invalidos };
  }

  // ---------------------------------------------------------------- financeiro
  /**
   * Contas a pagar do período (doc 03 §Financeiro).
   *
   * Título com parcelas aninhadas. As datas são obrigatórias na API; a janela é do chamador,
   * porque aqui o recorte útil é por vencimento futuro (fluxo de caixa), não por dia fechado.
   */
  async getContasPagar(
    contexto: SgCallContext,
    params: { dataInicial: string; dataFinal: string; filial?: number },
  ): Promise<ResultadoColeta<SgContaPagar>> {
    return this.coletarPaginado(
      contexto,
      `${BASE}/contas/pagar`,
      { dataInicial: params.dataInicial, dataFinal: params.dataFinal, filial: params.filial },
      'GET /contas/pagar',
      contaPagarSchema,
      'contas_pagar',
      'contas',
    );
  }

  async getContasReceber(
    contexto: SgCallContext,
    params: { dataInicial: string; dataFinal: string; filial?: number },
  ): Promise<ResultadoColeta<SgContaReceber>> {
    return this.coletarPaginado(
      contexto,
      `${BASE}/contas/receber`,
      { dataInicial: params.dataInicial, dataFinal: params.dataFinal, filial: params.filial },
      'GET /contas/receber',
      contaReceberSchema,
      'contas_receber',
      'contas',
    );
  }

  /** Tipos de despesa: dimensão pequena, sem filtro de data. */
  async listTiposDespesa(contexto: SgCallContext): Promise<ResultadoColeta<SgTipoDespesa>> {
    const corpo = await this.get(contexto, `${BASE}/despesas/tipos`, {}, 'GET /despesas/tipos');
    return this.coletar(
      contexto,
      tipoDespesaSchema,
      normalizarPagina(corpo, 'tipos').itens,
      'tipos_despesa',
    );
  }

  async getDespesas(
    contexto: SgCallContext,
    params: { dataInicial: string; dataFinal: string; filial?: number },
  ): Promise<ResultadoColeta<SgDespesa>> {
    return this.coletarPaginado(
      contexto,
      `${BASE}/despesas`,
      { dataInicial: params.dataInicial, dataFinal: params.dataFinal, filial: params.filial },
      'GET /despesas',
      despesaSchema,
      'despesas',
      'despesas',
    );
  }

  /** Transações de cartão. Este endpoint devolve array puro — o normalizador já cobre o caso. */
  async getCartoes(
    contexto: SgCallContext,
    params: { dataInicial: string; dataFinal: string; filial?: number },
  ): Promise<ResultadoColeta<SgCartaoVenda>> {
    return this.coletarPaginado(
      contexto,
      `${BASE}/vendascartoes`,
      { dataInicial: params.dataInicial, dataFinal: params.dataFinal, filial: params.filial },
      'GET /vendascartoes',
      cartaoVendaSchema,
      'cartoes',
    );
  }

  // ---------------------------------------------------------------- compras
  async getPedidosCompra(
    contexto: SgCallContext,
    params: { dataInicial: string; dataFinal: string; filial?: number },
  ): Promise<ResultadoColeta<SgPedidoCompra>> {
    return this.coletarPaginado(
      contexto,
      `${BASE}/pedidoscompra`,
      { dataInicial: params.dataInicial, dataFinal: params.dataFinal, filial: params.filial },
      'GET /pedidoscompra',
      pedidoCompraSchema,
      'pedidos_compra',
      'pedidos',
    );
  }

  async getEntradas(
    contexto: SgCallContext,
    params: { dataInicial: string; dataFinal: string; filial?: number },
  ): Promise<ResultadoColeta<SgNotaEntrada>> {
    return this.coletarPaginado(
      contexto,
      `${BASE}/entradas`,
      { dataInicial: params.dataInicial, dataFinal: params.dataFinal, filial: params.filial },
      'GET /entradas',
      notaEntradaSchema,
      'entradas',
      'entradas',
    );
  }

  /**
   * Previsão de vendas do mês (E5-11, doc 15 §7).
   *
   * [NECESSITA CONFIRMAÇÃO] O doc 03 marca esta rota como **sem filtro de período**, o que sugere
   * que ela devolve as competências abertas (mês corrente e próximo) de uma vez. Os parâmetros
   * `mes`/`ano` são enviados assim mesmo: se a API os ignorar, o resultado é o mesmo; se ela os
   * respeitar, deixamos de puxar o histórico inteiro a cada ciclo.
   */
  async getPrevisaoVendas(
    contexto: SgCallContext,
    params: { mes?: number; ano?: number; filial?: number } = {},
  ): Promise<ResultadoColeta<SgPrevisaoVendas>> {
    return this.coletarPaginado(
      contexto,
      `${BASE}/previsaovendas`,
      { mes: params.mes, ano: params.ano, filial: params.filial },
      'GET /previsaovendas',
      previsaoVendasSchema,
      'previsao_vendas',
      'previsoes',
    );
  }

  /** Curva diária da previsão — exige filial, como todo recurso com recorte por loja (doc 03). */
  async getPrevisaoVendasDiaria(
    contexto: SgCallContext,
    params: { filial: number; mes?: number; ano?: number },
  ): Promise<ResultadoColeta<SgPrevisaoVendasDiaria>> {
    return this.coletarPaginado(
      contexto,
      `${BASE}/previsaovendas/diaria`,
      { filial: params.filial, mes: params.mes, ano: params.ano },
      'GET /previsaovendas/diaria',
      previsaoVendasDiariaSchema,
      'previsao_vendas_diaria',
      'previsoes',
    );
  }

  // ---------------------------------------------------------------- infraestrutura interna
  /**
   * Percorre todas as páginas de um recurso e valida cada item.
   *
   * Os recursos financeiros e de compras seguem todos o mesmo molde — período obrigatório,
   * envelope paginado (ou array puro, em cartões) e um schema por recurso —, então o laço mora
   * aqui em vez de repetido em cada operação.
   */
  private async coletarPaginado<S extends z.ZodTypeAny>(
    contexto: SgCallContext,
    caminho: string,
    query: Record<string, unknown>,
    rota: string,
    schema: S,
    dominio: string,
    chaveItens?: string,
  ): Promise<ResultadoColeta<z.infer<S>>> {
    const itens: Array<z.infer<S>> = [];
    let invalidos = 0;
    let paginas = 0;

    for await (const pagina of this.paginar(contexto, caminho, query, rota, {
      chaveItens,
      prioridade: 'backfill',
    })) {
      paginas += 1;
      const coleta = await this.coletar(contexto, schema, pagina, dominio);
      itens.push(...coleta.itens);
      invalidos += coleta.invalidos;
    }

    return { itens, invalidos, paginas };
  }

  /**
   * Itera as páginas de um recurso tolerando os três formatos de envelope da API
   * (`paginacao`, `ordenacao` ou array puro — doc 02 §3).
   */
  private async *paginar(
    contexto: SgCallContext,
    caminho: string,
    query: Record<string, unknown>,
    rota: string,
    opcoes: {
      /** Ausente = o tamanho sai da configuração do tenant/instalação (doc 34 Q4). */
      itensPorPagina?: number;
      chaveItens?: string;
      pesado?: boolean;
      prioridade?: PrioridadeChamada;
    },
  ): AsyncGenerator<unknown[]> {
    let pagina = 1;
    let totalPaginas = 1;
    // Tamanho efetivo: o teto já aprendido para esta rota vence o pedido, e o pedido vence o
    // padrão. É a resposta da Q4 morando em dado.
    const inicial = this.tamanhoDePagina(contexto, rota, opcoes.itensPorPagina);
    let itensPorPagina = inicial;
    let aprendizadoPendente = false;

    do {
      let corpo;
      try {
        corpo = await this.get(contexto, caminho, { ...query, pagina, itensPorPagina }, rota, {
          pesado: opcoes.pesado,
          prioridade: opcoes.prioridade,
        });
      } catch (erro) {
        // A SG não documenta o teto de `itensPorPagina` por endpoint (doc 34 Q4), e um endpoint
        // que recusa o tamanho responde 400 — indistinguível, para nós, de "parâmetro errado".
        // Em vez de quarentenar a varredura inteira, cortamos o tamanho pela metade e tentamos
        // de novo. Reduzir aqui é só uma SONDAGEM: o valor só vira fato aprendido depois que
        // uma resposta a esse tamanho chega inteira (ver abaixo).
        const menor = this.reduzirPagina(itensPorPagina);
        if (!(erro instanceof SgError) || erro.falha !== 'requisicao_invalida' || menor === null) {
          throw erro;
        }

        this.logger.warn(
          {
            event: 'sg_pagina_reduzida',
            tenant_id: contexto.conexao.tenantId,
            rota,
            de: itensPorPagina,
            para: menor,
          },
          'sg_pagina_reduzida',
        );
        itensPorPagina = menor;
        aprendizadoPendente = true;
        continue;
      }

      // Só agora o tamanho vira aprendizado. Gravar na hora da redução, como era antes, fazia
      // com que QUALQUER 400 — inclusive um sobre outro parâmetro — baixasse permanentemente a
      // página da rota: a homologação recusa `/filiais/vendas` por motivo alheio ao tamanho, e o
      // cliente ia cortando 200 → 100 → 50 e gravando cada palpite. Como nada nunca aumenta o
      // valor de volta, era uma catraca só para baixo sobre dado de outro tenant.
      if (aprendizadoPendente) {
        aprendizadoPendente = false;
        await contexto.aprender?.({ pageSizePorRota: { [rota]: itensPorPagina } });
      }

      const normalizada = normalizarPagina(corpo, opcoes.chaveItens);
      totalPaginas = normalizada.quantidadePaginas;
      yield normalizada.itens;

      // Página vazia encerra a varredura mesmo que o envelope prometa mais: é a defesa contra
      // laço infinito quando o total vem errado.
      if (normalizada.itens.length === 0) break;
      pagina += 1;
    } while (pagina <= totalPaginas);
  }

  /**
   * Tamanho de página efetivo para uma rota (doc 34 Q4).
   *
   * Precedência: teto aprendido para a rota → tamanho pedido pelo chamador → configuração do
   * tenant → padrão da instalação. O aprendido vem primeiro porque é o único dos quatro que foi
   * confirmado pela própria API.
   */
  private tamanhoDePagina(contexto: SgCallContext, rota: string, pedido?: number): number {
    const desejado = pedido ?? contexto.conexao.pageSize ?? this.config.sg.pageSize;
    // O teto aprendido veio da própria API recusando um valor maior; o padrão da rota é só a
    // nossa suposição. Por isso o aprendido vence quando existe.
    const teto = contexto.conexao.pageSizePorRota?.[rota] ?? TETO_POR_ROTA[rota];
    return teto ? Math.min(teto, desejado) : desejado;
  }

  /** Metade, até o piso da instalação. `null` quando já se está no piso — aí o 400 é outro. */
  private reduzirPagina(atual: number): number | null {
    const piso = this.config.sg.pageSizeMin;
    if (atual <= piso) return null;
    return Math.max(piso, Math.floor(atual / 2));
  }

  /**
   * Valida cada item contra o schema. Item ruim vai para quarentena e a página continua
   * (doc 12 §4.7): um registro corrompido no ERP não pode parar a sincronização inteira.
   */
  private async coletar<S extends z.ZodTypeAny>(
    contexto: SgCallContext,
    schema: S,
    brutos: unknown[],
    dominio: string,
  ): Promise<ResultadoColeta<z.infer<S>>> {
    const itens: Array<z.infer<S>> = [];
    let invalidos = 0;

    for (const bruto of brutos) {
      const parsed = schema.safeParse(bruto);
      if (parsed.success) {
        itens.push(parsed.data);
        continue;
      }

      invalidos += 1;
      this.metrics.sgInvalidItemsTotal.inc({ tenant: contexto.conexao.tenantId, domain: dominio });
      this.logger.warn(
        {
          event: 'sg_item_quarentenado',
          tenant_id: contexto.conexao.tenantId,
          dominio,
          // Só o caminho e a regra: o item pode conter PII, e ele não vai para o log (doc 18 §1).
          problemas: parsed.error.issues.slice(0, 5).map((issue) => ({
            path: issue.path.join('.'),
            rule: issue.code,
          })),
        },
        'sg_item_quarentenado',
      );
    }

    return { itens, invalidos };
  }

  /**
   * Executa um GET autenticado: confere a rota contra o contrato, obtém o token, e em 401
   * renova uma única vez — inclusive testando o outro formato de header (doc 34 Q2).
   */
  private async get(
    contexto: SgCallContext,
    caminho: string,
    query: Record<string, unknown>,
    rota: string,
    opcoes: { pesado?: boolean; prioridade?: PrioridadeChamada } = {},
  ): Promise<unknown> {
    assertRotaContratada(contexto.conexao.routesGranted, rota);

    const token = await this.tokens.getToken({
      conexao: contexto.conexao,
      credenciais: contexto.credenciais,
    });

    const executar = async (headerMode: 'raw' | 'bearer', segundaTentativa: boolean) =>
      this.http.request(
        { ...contexto.conexao, token: token.token, authHeaderMode: headerMode },
        {
          method: 'GET',
          path: caminho,
          query: query as never,
          pesado: opcoes.pesado,
          prioridade: opcoes.prioridade ?? contexto.prioridade,
          segundaTentativa,
        },
      );

    try {
      const resposta = await executar(token.headerMode, false);
      return resposta.corpo;
    } catch (erro) {
      if (!(erro instanceof SgError) || erro.falha !== 'token_expirado') throw erro;

      // 401 pode ser token vencido **ou** formato de header errado. Renovamos e tentamos o
      // formato alternativo: se funcionar, o modo correto fica registrado para as próximas.
      await this.tokens.invalidate(contexto.conexao.tenantId);
      const renovado = await this.tokens.getToken({
        conexao: contexto.conexao,
        credenciais: contexto.credenciais,
      });

      try {
        const resposta = await executar(renovado.headerMode, true);
        return resposta.corpo;
      } catch (segundoErro) {
        if (!(segundoErro instanceof SgError)) throw segundoErro;

        const alternativo = renovado.headerMode === 'raw' ? 'bearer' : 'raw';
        const resposta = await executar(alternativo, true);
        await this.tokens.registrarHeaderMode(contexto.conexao.tenantId, alternativo);
        // Além do cache: o cadastro do tenant passa a nascer no formato certo, e a instalação
        // deixa de pagar um 401 de aprendizado a cada renovação de token.
        await contexto.aprender?.({ authHeaderMode: alternativo });
        this.logger.info(
          {
            event: 'sg_header_mode_descoberto',
            tenant_id: contexto.conexao.tenantId,
            headerMode: alternativo,
          },
          'sg_header_mode_descoberto',
        );
        return resposta.corpo;
      }
    }
  }
}

/**
 * Falha rápido quando a rota não está no contrato do tenant (doc 12 §5): melhor um erro claro
 * que uma chamada que volta 401 e faz o disjuntor desconfiar do ERP à toa.
 *
 * O formato exato da claim `routes` ("GET /filiais" vs caminho completo) não está documentado,
 * então a comparação é por sufixo — tolerante de propósito.
 */
export function assertRotaContratada(routesGranted: string[], rota: string): void {
  // Conexão ainda sem token (primeiro uso): não há o que conferir.
  if (routesGranted.length === 0) return;

  const alvo = rota.trim().toUpperCase();
  const [metodo, caminho] = alvo.split(' ');

  const contratada = routesGranted.some((concedida) => {
    const normalizada = concedida.trim().toUpperCase();
    if (normalizada === alvo) return true;
    if (!caminho) return false;
    const [metodoConcedido, caminhoConcedido] = normalizada.split(' ');
    return metodoConcedido === metodo && (caminhoConcedido?.endsWith(caminho) ?? false);
  });

  if (!contratada) {
    throw new SgError('rota_nao_contratada', {
      endpoint: rota,
      mensagemOrigem: 'rota ausente da claim routes do token',
    });
  }
}

/** Guarda de janela: a API recusa períodos acima de 30 dias em séries históricas. */
export function assertJanela(dataInicial: string, dataFinal: string): void {
  const inicio = Date.parse(`${dataInicial}T00:00:00Z`);
  const fim = Date.parse(`${dataFinal}T00:00:00Z`);

  if (Number.isNaN(inicio) || Number.isNaN(fim)) {
    throw new SgError('requisicao_invalida', { mensagemOrigem: 'datas inválidas' });
  }
  if (fim < inicio) {
    throw new SgError('requisicao_invalida', { mensagemOrigem: 'data final antes da inicial' });
  }

  const dias = Math.floor((fim - inicio) / 86_400_000) + 1;
  if (dias > JANELA_MAXIMA_DIAS) {
    throw new SgError('requisicao_invalida', {
      mensagemOrigem: `janela de ${dias} dias excede o máximo de ${JANELA_MAXIMA_DIAS}`,
    });
  }
}
