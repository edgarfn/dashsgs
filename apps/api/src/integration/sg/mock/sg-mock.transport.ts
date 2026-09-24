import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { type SgTransport } from '../http/sg-http.client';
import {
  gerarFinalizadorasDoDia,
  gerarPrevisaoDiaria,
  gerarPrevisaoVendas,
  gerarResumoFilial,
  gerarVendasDoDia,
} from './gerador';
import {
  FIXTURE_AUTORIZACAO,
  FIXTURE_DEPARTAMENTOS_N1,
  FIXTURE_FILIAIS,
  FIXTURE_CARTOES,
  FIXTURE_CONTAS_PAGAR,
  FIXTURE_CONTAS_RECEBER,
  FIXTURE_DESPESAS,
  FIXTURE_ENTRADAS,
  FIXTURE_FINALIZADORAS_HOJE,
  FIXTURE_GTINS,
  FIXTURE_PEDIDOS_COMPRA,
  FIXTURE_TIPOS_DESPESA,
  FIXTURE_MARCAS,
  FIXTURE_PRODUTOS,
  FIXTURE_STATUS,
  FIXTURE_VENDAS_HOJE,
} from './fixtures';

/** Usuário/senha aceitos pelo mock — qualquer outro par recebe 401, como a API real. */
export const MOCK_USUARIO = 'homologacao';
export const MOCK_SENHA = 'homologacao-senha-de-teste';

/**
 * Transporte de mentira para `SG_MOCK=true` (doc 24 §3).
 *
 * Serve as fixtures sem tocar na rede, e **imita os comportamentos que importam**: 401 com
 * credencial errada, 401 quando falta o header, 400 para parâmetro obrigatório ausente e envelopes
 * inconsistentes. Um mock que só devolve 200 com dado limpo daria a falsa sensação de que a
 * integração funciona — e o primeiro contato com o ERP de verdade desmentiria.
 *
 * Nunca é ativado em produção: o contrato de ambiente recusa `SG_MOCK` lá (doc 19 §3).
 */
@Injectable()
export class SgMockTransport implements SgTransport {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(SgMockTransport.name);
  }

  async fetch(url: string, init: RequestInit): Promise<Response> {
    const alvo = new URL(url);
    const caminho = alvo.pathname.replace('/public', '');
    const metodo = (init.method ?? 'GET').toUpperCase();

    this.logger.debug({ event: 'sg_mock_call', metodo, caminho }, 'sg_mock_call');

    if (metodo === 'POST' && caminho.endsWith('/autorizacao')) {
      return this.autorizar(init);
    }

    // Toda rota exige o header Authorization (doc 03, convenções).
    const autorizacao = header(init, 'authorization');
    if (!autorizacao) return json({ error: 'Nao autorizado' }, 401);

    if (caminho.endsWith('/sgsistemas/v1/status')) return json(FIXTURE_STATUS);
    if (caminho.endsWith('/filiais/vendas')) return this.resumoFilial(alvo);
    if (caminho.endsWith('/filiais')) return json(FIXTURE_FILIAIS);
    if (caminho.endsWith('/marcas')) return json(FIXTURE_MARCAS);
    if (caminho.endsWith('/departamentos/nivel1')) return json(FIXTURE_DEPARTAMENTOS_N1);
    if (caminho.endsWith('/contas/pagar')) return this.comPeriodo(alvo, FIXTURE_CONTAS_PAGAR);
    if (caminho.endsWith('/contas/receber')) return this.comPeriodo(alvo, FIXTURE_CONTAS_RECEBER);
    if (caminho.endsWith('/despesas/tipos')) return json(FIXTURE_TIPOS_DESPESA);
    if (caminho.endsWith('/despesas')) return this.comPeriodo(alvo, FIXTURE_DESPESAS);
    // Array puro, sem envelope: a inconsistência documentada no doc 02 §3.
    if (caminho.endsWith('/vendascartoes')) return this.comPeriodo(alvo, FIXTURE_CARTOES);
    if (caminho.endsWith('/pedidoscompra')) return this.comPeriodo(alvo, FIXTURE_PEDIDOS_COMPRA);
    if (caminho.endsWith('/entradas')) return this.comPeriodo(alvo, FIXTURE_ENTRADAS);
    // A diária vem ANTES: `/previsaovendas` é prefixo dela, e trocar a ordem faria a rota
    // específica nunca ser alcançada.
    if (caminho.endsWith('/previsaovendas/diaria')) return this.previsaoDiaria(alvo);
    if (caminho.endsWith('/previsaovendas')) return this.previsaoVendas(alvo);
    if (caminho.endsWith('/produtos/gtins')) return this.paginado(alvo, FIXTURE_GTINS, 'gtins');
    if (caminho.endsWith('/produtos')) return this.paginado(alvo, FIXTURE_PRODUTOS, 'produtos');
    if (caminho.endsWith('/vendas/hoje')) return this.exigeFilial(alvo, FIXTURE_VENDAS_HOJE);
    // `endsWith('/finalizadoras/hoje')` sozinho casava com QUALQUER prefixo, inclusive o
    // caminho que faltava o segmento `/vendas` — o mock aceitava a chamada errada como se
    // fosse a documentada, e só o servidor real (que confere o caminho inteiro) acusou o 404.
    // Ver `getFinalizadoras` em sg.client.ts e doc 34 §4.7: o cliente já foi corrigido, isto
    // aqui é para a mesma regressão não voltar a passar despercebida pelo mock.
    if (caminho.endsWith('/vendas/finalizadoras/hoje'))
      return this.exigeFilial(alvo, FIXTURE_FINALIZADORAS_HOJE);
    if (caminho.endsWith('/vendas/finalizadoras')) return this.finalizadorasDoDia(alvo);
    if (caminho.endsWith('/vendas')) return this.vendasDoDia(alvo);

    // A API usa 400 com mensagem em português também para "não encontrei" (doc 02 §4.8).
    return json({ error: 'Rota nao encontrada' }, 404);
  }

  private async autorizar(init: RequestInit): Promise<Response> {
    const corpo = parseBody(init.body);
    if (corpo?.usuario !== MOCK_USUARIO || corpo?.senha !== MOCK_SENHA) {
      // A API responde 401 **sem corpo** na credencial inválida (doc 12 §2).
      return new Response(null, { status: 401 });
    }
    return json(FIXTURE_AUTORIZACAO);
  }

  private vendasDoDia(alvo: URL): Response {
    const filial = alvo.searchParams.get('filial');
    const data = alvo.searchParams.get('data');
    if (!filial || !data) {
      return json({ error: 'Parametros obrigatorios: filial, data' }, 400);
    }
    return json(gerarVendasDoDia(Number(filial), data));
  }

  private finalizadorasDoDia(alvo: URL): Response {
    const filial = alvo.searchParams.get('filial');
    const data = alvo.searchParams.get('data');
    if (!filial || !data) {
      return json({ error: 'Parametros obrigatorios: filial, data' }, 400);
    }
    return json(gerarFinalizadorasDoDia(Number(filial), data));
  }

  private exigeFilial(alvo: URL, fixture: unknown): Response {
    if (!alvo.searchParams.get('filial')) {
      return json({ error: 'Parametros obrigatorios: filial' }, 400);
    }
    return json(fixture);
  }

  /** Endpoints financeiros exigem o período — sem ele a API responde 400 (doc 03). */
  private comPeriodo(alvo: URL, fixture: unknown): Response {
    const inicial = alvo.searchParams.get('dataInicial');
    const final = alvo.searchParams.get('dataFinal');
    if (!inicial || !final) {
      return json({ error: 'Parametros obrigatorios: dataInicial, dataFinal' }, 400);
    }
    return json(fixture);
  }

  /** Sem filtro de período nesta rota (doc 03): o mês vem por `mes`/`ano`, com hoje como padrão. */
  private previsaoVendas(alvo: URL): Response {
    const { ano, mes } = this.competencia(alvo);
    const filial = alvo.searchParams.get('filial');
    const filiais = filial ? [Number(filial)] : [1, 2];
    return json(gerarPrevisaoVendas(filiais, ano, mes));
  }

  private previsaoDiaria(alvo: URL): Response {
    const filial = alvo.searchParams.get('filial');
    if (!filial) return json({ error: 'Parametros obrigatorios: filial' }, 400);

    const { ano, mes } = this.competencia(alvo);
    return json(gerarPrevisaoDiaria(Number(filial), ano, mes));
  }

  private competencia(alvo: URL): { ano: number; mes: number } {
    const agora = new Date();
    return {
      ano: Number(alvo.searchParams.get('ano')) || agora.getUTCFullYear(),
      mes: Number(alvo.searchParams.get('mes')) || agora.getUTCMonth() + 1,
    };
  }

  private resumoFilial(alvo: URL): Response {
    const dataInicial = alvo.searchParams.get('dataInicial');
    const dataFinal = alvo.searchParams.get('dataFinal');
    if (!dataInicial || !dataFinal) {
      return json({ error: 'Parametros obrigatorios: dataInicial, dataFinal' }, 400);
    }

    // Singular, como toda rota que recorta por filial — a API real recusa com 400 quando o
    // cliente manda `filiais` (doc 34 §4.7). Sem essa exigência aqui, o mock aceitaria a mesma
    // regressão que só a homologação real acusou.
    const filial = alvo.searchParams.get('filial');
    if (!filial) {
      return json({ error: 'Parametros obrigatorios nao informados: filial' }, 400);
    }

    const hoje = new Date().toISOString().slice(0, 10);
    return json(gerarResumoFilial([Number(filial)], dataInicial, dataFinal, hoje));
  }

  /** Devolve página vazia a partir da segunda: exercita o laço de paginação de verdade. */
  private paginado(alvo: URL, fixture: Record<string, unknown>, chave: string): Response {
    const pagina = Number(alvo.searchParams.get('pagina') ?? '1');
    if (pagina > 1) {
      return json({
        paginacao: { pagina, itensPorPagina: 500, quantidadePaginas: 1, quantidadeItens: 0 },
        [chave]: [],
      });
    }
    return json(fixture);
  }
}

function header(init: RequestInit, nome: string): string | null {
  const headers = init.headers as Record<string, string> | undefined;
  if (!headers) return null;
  const chave = Object.keys(headers).find((item) => item.toLowerCase() === nome);
  return chave ? (headers[chave] ?? null) : null;
}

function parseBody(body: RequestInit['body']): Record<string, string> | null {
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body) as Record<string, string>;
  } catch {
    return null;
  }
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
