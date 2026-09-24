import { type ErrorCode } from '@dashsgs/shared';
import { AppException } from '../../common/errors/app.exception';

/**
 * Tradução dos erros da API SG para o vocabulário interno (doc 12 §8).
 *
 * A API responde `{"error": "mensagem em PT"}` sem código nem correlação, e usa 400 para "não
 * encontrado" em alguns módulos e 404 em outros (doc 02 §4.8). Quem consome a integração não
 * precisa saber disso: recebe um erro classificado, com a decisão de retry já embutida.
 */
/**
 * Vocabulário fechado das falhas da SG. Existe em runtime, e não só como tipo, porque ele
 * também é **rótulo de métrica** (`sg_token_refresh_total{result}`): o alerta de credencial
 * inválida do doc 18 §5 casa por esse valor, e um alerta que procura um rótulo inexistente
 * fica silencioso para sempre sem nunca acusar erro.
 */
export const SG_FALHAS = [
  /** Credencial recusada na autorização — a conexão do tenant precisa de atenção humana. */
  'credenciais_invalidas',
  /** Token expirou no meio do uso: renovar e repetir uma vez. */
  'token_expirado',
  /** A rota não está no contrato do tenant com a SG. */
  'rota_nao_contratada',
  /** Parâmetros errados — bug nosso, não adianta repetir. */
  'requisicao_invalida',
  /** Recurso inexistente: tratar como vazio, não como erro. */
  'nao_encontrado',
  /** Erro do lado do ERP: vale repetir com backoff. */
  'erro_servidor',
  /** Rede, DNS, timeout: vale repetir com backoff. */
  'inalcancavel',
  /**
   * A API pediu para diminuir o ritmo (429). Vale repetir, respeitando `Retry-After`.
   *
   * A SG não documenta limite algum (doc 34 Q3), então este caso pode nunca acontecer — mas se
   * acontecer, ele precisa ser retentável. Sem esta entrada, 429 caía em `resposta_invalida`,
   * que na taxonomia significa "não repetir, quarentenar": o produto jogaria a página fora e
   * marcaria o dado do cliente como inválido porque o servidor pediu calma.
   */
  'limite_excedido',
  /** Resposta fora do contrato: não repetir, quarentenar. */
  'resposta_invalida',
] as const;

export type SgFalha = (typeof SG_FALHAS)[number];

export class SgError extends Error {
  constructor(
    readonly falha: SgFalha,
    readonly detalhe: {
      status?: number;
      /** Espera pedida pelo servidor no header `Retry-After`, já convertida para ms. */
      retryAfterMs?: number;
      endpoint?: string;
      /** Mensagem crua da API SG — vai para log/auditoria, nunca para o usuário final. */
      mensagemOrigem?: string | null;
      causa?: unknown;
    } = {},
  ) {
    // A mensagem do Error é o que aparece em stack trace e no Sentry: vale dizer POR QUE
    // falhou, e não só a categoria. Para o usuário final existe `toAppException()`, que é
    // deliberadamente genérica (doc 09 §1).
    super(
      [
        `SG:${falha}`,
        detalhe.endpoint ? `(${detalhe.endpoint})` : null,
        detalhe.mensagemOrigem ? `- ${detalhe.mensagemOrigem}` : null,
      ]
        .filter(Boolean)
        .join(' '),
    );
    this.name = 'SgError';
  }

  /** Só faz sentido repetir o que é transitório — e apenas em leitura (doc 12 §3). */
  get retentavel(): boolean {
    return (
      this.falha === 'erro_servidor' ||
      this.falha === 'inalcancavel' ||
      this.falha === 'limite_excedido'
    );
  }

  /** Quanto esperar antes de repetir, quando o próprio servidor disse (header `Retry-After`). */
  get esperaSugeridaMs(): number | null {
    return this.detalhe.retryAfterMs ?? null;
  }

  /** Falhas que indicam problema de configuração/contrato, e não indisponibilidade. */
  get exigeIntervencao(): boolean {
    return this.falha === 'credenciais_invalidas' || this.falha === 'rota_nao_contratada';
  }

  /**
   * Resumo para o operador — vai em `last_error` e na tela de Conexão ERP.
   *
   * Carrega o **endpoint**: sem ele, um 404 de corpo vazio (que é o que esta API devolve quando
   * o caminho não existe) chega como `nao_encontrado` puro, e quem lê não tem como saber se foi
   * a autorização ou o /status — que é a diferença entre "prefixo/SG Cloud errado no cadastro" e
   * "rota fora do contrato". Não é mensagem de usuário final: essa continua em `toAppException()`.
   */
  descricaoOperacional(): string {
    return [
      this.falha,
      this.detalhe.endpoint ? `em ${this.detalhe.endpoint}` : null,
      this.detalhe.status ? `(HTTP ${this.detalhe.status})` : null,
      this.detalhe.mensagemOrigem ? `: ${this.detalhe.mensagemOrigem}` : null,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(' :', ':');
  }

  /**
   * Erro que o usuário do DashSGS vai ver. Nunca repassa a mensagem crua do ERP: ela pode
   * conter nome de tabela, caminho e outros detalhes internos da instalação (doc 09 §1).
   */
  toAppException(): AppException {
    const mapa: Record<SgFalha, { code: ErrorCode; message: string }> = {
      credenciais_invalidas: {
        code: 'ERP_CREDENTIALS_INVALID',
        message: 'As credenciais da conexão com o ERP não foram aceitas.',
      },
      token_expirado: {
        code: 'ERP_UNREACHABLE',
        message: 'A sessão com o ERP expirou. Tente novamente em instantes.',
      },
      rota_nao_contratada: {
        code: 'ERP_ROUTE_FORBIDDEN',
        message: 'A rota necessária não está contratada nesta conexão com o ERP.',
      },
      limite_excedido: {
        code: 'ERP_UNREACHABLE',
        message: 'O ERP pediu para reduzir o ritmo das consultas. Tente novamente em instantes.',
      },
      requisicao_invalida: {
        code: 'ERP_UNREACHABLE',
        message: 'O ERP recusou a consulta. A equipe foi notificada.',
      },
      nao_encontrado: {
        code: 'NOT_FOUND',
        message: 'Recurso não encontrado no ERP.',
      },
      erro_servidor: {
        code: 'ERP_UNREACHABLE',
        message: 'O ERP respondeu com erro. Tentaremos novamente automaticamente.',
      },
      inalcancavel: {
        code: 'ERP_UNREACHABLE',
        message: 'Não foi possível falar com o ERP neste momento.',
      },
      resposta_invalida: {
        code: 'ERP_UNREACHABLE',
        message: 'O ERP respondeu em formato inesperado. A equipe foi notificada.',
      },
    };

    const { code, message } = mapa[this.falha];
    return new AppException(code, {
      message,
      logContext: {
        falha: this.falha,
        status: this.detalhe.status,
        endpoint: this.detalhe.endpoint,
        mensagemOrigem: this.detalhe.mensagemOrigem,
      },
    });
  }
}

/** Classifica uma resposta HTTP da API SG (doc 12 §8). */
export function classificarResposta(
  status: number,
  corpo: unknown,
  contexto: {
    endpoint: string;
    autorizacao?: boolean;
    segundaTentativa?: boolean;
    retryAfterMs?: number;
  },
): SgError {
  const mensagemOrigem =
    corpo && typeof corpo === 'object' && 'error' in corpo
      ? String((corpo as { error: unknown }).error)
      : null;

  if (status === 401) {
    if (contexto.autorizacao) {
      return new SgError('credenciais_invalidas', { status, mensagemOrigem, ...contexto });
    }
    // 401 numa rota comum: primeiro tratamos como token vencido; se acontecer de novo logo
    // depois de renovar, a leitura honesta é que a rota não está no contrato (doc 12 §8).
    return new SgError(contexto.segundaTentativa ? 'rota_nao_contratada' : 'token_expirado', {
      status,
      mensagemOrigem,
      endpoint: contexto.endpoint,
    });
  }

  if (status === 403) {
    return new SgError('rota_nao_contratada', { status, mensagemOrigem, ...contexto });
  }

  if (status === 404) {
    return new SgError('nao_encontrado', { status, mensagemOrigem, ...contexto });
  }

  if (status === 400) {
    // A API usa 400 tanto para "faltou parâmetro" quanto para "não achei" (doc 02 §4.8).
    const pareceNaoEncontrado = /n[aã]o\s+(foi\s+)?encontrad|inexistente|nenhum/i.test(
      mensagemOrigem ?? '',
    );
    return new SgError(pareceNaoEncontrado ? 'nao_encontrado' : 'requisicao_invalida', {
      status,
      mensagemOrigem,
      endpoint: contexto.endpoint,
    });
  }

  if (status === 429) {
    return new SgError('limite_excedido', { status, mensagemOrigem, ...contexto });
  }

  if (status >= 500) {
    return new SgError('erro_servidor', { status, mensagemOrigem, ...contexto });
  }

  return new SgError('resposta_invalida', { status, mensagemOrigem, ...contexto });
}

/** Erros de rede/timeout do fetch viram `inalcancavel`. */
export function erroDeRede(causa: unknown, endpoint: string): SgError {
  return new SgError('inalcancavel', { endpoint, causa });
}
