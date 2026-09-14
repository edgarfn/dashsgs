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
  type SgTipoDespesa,
  type SgProduto,
  type SgResumoFilial,
  type SgStatus,
  type SgVendaCupom,
} from './types';

const BASE = '/integracao/sgsistemas/v1';

/** Recorte máximo aceito pela API em séries históricas (doc 03 / doc 12 §3). */
export const JANELA_MAXIMA_DIAS = 30;

export interface SgCallContext {
  conexao: SgConnectionContext & {
    isSgCloud: boolean;
    authPathOverride?: string | null;
    /** Claim `routes` do último token — o contrato real deste tenant com a SG. */
    routesGranted: string[];
  };
  credenciais: () => Promise<{ usuario: string; senha: string }>;
  prioridade?: PrioridadeChamada;
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
        itensPorPagina: filtro.itensPorPagina ?? this.config.sg.pageSize,
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
        itensPorPagina: filtro.itensPorPagina ?? this.config.sg.pageSize,
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
    const caminho = params.hoje ? `${BASE}/finalizadoras/hoje` : `${BASE}/vendas/finalizadoras`;
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

  /** Resumo diário por filial — janela documentada de 30 dias (doc 03). */
  async getResumoFilial(
    contexto: SgCallContext,
    params: { filiais: number[]; dataInicial: string; dataFinal: string },
  ): Promise<ResultadoColeta<SgResumoFilial>> {
    assertJanela(params.dataInicial, params.dataFinal);

    const itens: SgResumoFilial[] = [];
    let invalidos = 0;

    for await (const pagina of this.paginar(
      contexto,
      `${BASE}/filiais/vendas`,
      {
        filiais: params.filiais,
        dataInicial: params.dataInicial,
        dataFinal: params.dataFinal,
      },
      'GET /filiais/vendas',
      { itensPorPagina: 200, chaveItens: 'vendas', prioridade: 'backfill' },
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
      itensPorPagina: this.config.sg.pageSize,
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
      itensPorPagina: number;
      chaveItens?: string;
      pesado?: boolean;
      prioridade?: PrioridadeChamada;
    },
  ): AsyncGenerator<unknown[]> {
    let pagina = 1;
    let totalPaginas = 1;

    do {
      const corpo = await this.get(
        contexto,
        caminho,
        { ...query, pagina, itensPorPagina: opcoes.itensPorPagina },
        rota,
        { pesado: opcoes.pesado, prioridade: opcoes.prioridade },
      );

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
