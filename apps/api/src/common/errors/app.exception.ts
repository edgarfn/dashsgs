import { ERROR_HTTP_STATUS, type ErrorCode } from '@dashsgs/shared';
import { HttpException } from '@nestjs/common';

/**
 * Mensagens seguras por código (doc 09 §1: "mensagem_segura").
 * Nenhuma revela existência de recurso de outro tenant, nome de tabela ou detalhe de infra.
 */
export const SAFE_MESSAGES: Record<ErrorCode, string> = {
  AUTH_INVALID_CREDENTIALS: 'Credenciais inválidas.',
  AUTH_MFA_REQUIRED: 'Verificação em duas etapas necessária.',
  AUTH_LOCKED: 'Conta temporariamente bloqueada. Tente novamente mais tarde.',
  AUTH_REQUIRED: 'Autenticação necessária.',
  FORBIDDEN: 'Você não tem permissão para esta operação.',
  NOT_FOUND: 'Recurso não encontrado.',
  VALIDATION_ERROR: 'Dados inválidos na requisição.',
  RATE_LIMITED: 'Muitas requisições. Tente novamente em instantes.',
  ERP_UNREACHABLE: 'Não foi possível falar com o ERP neste momento.',
  ERP_CREDENTIALS_INVALID: 'As credenciais da conexão com o ERP não foram aceitas.',
  ERP_ROUTE_FORBIDDEN: 'A rota necessária não está contratada nesta conexão com o ERP.',
  EXPORT_LIMIT: 'Limite de exportações atingido.',
  CONFLICT: 'A operação conflita com o estado atual do recurso.',
  INTERNAL: 'Erro interno. A equipe foi notificada.',
  SERVICE_UNAVAILABLE: 'Serviço temporariamente indisponível.',
};

export interface AppExceptionOptions {
  /** Mensagem segura alternativa (ainda sem detalhe interno). */
  message?: string;
  /** Detalhes de validação: caminho + regra. NUNCA o valor recebido. */
  details?: Array<{ path: string; rule: string }>;
  /** Contexto que vai apenas para o log estruturado, nunca para a resposta. */
  logContext?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * Exceção de domínio da aplicação. O status HTTP sai do mapa único do pacote shared,
 * garantindo que API, front e testes de contrato falem do mesmo catálogo (doc 23).
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: Array<{ path: string; rule: string }>;
  readonly logContext?: Record<string, unknown>;

  constructor(code: ErrorCode, options: AppExceptionOptions = {}) {
    super(options.message ?? SAFE_MESSAGES[code], ERROR_HTTP_STATUS[code], {
      cause: options.cause,
    });
    this.code = code;
    this.details = options.details;
    this.logContext = options.logContext;
    this.name = 'AppException';
  }

  static notFound(logContext?: Record<string, unknown>): AppException {
    return new AppException('NOT_FOUND', { logContext });
  }

  static forbidden(logContext?: Record<string, unknown>): AppException {
    return new AppException('FORBIDDEN', { logContext });
  }

  static validation(
    details: Array<{ path: string; rule: string }>,
    logContext?: Record<string, unknown>,
  ): AppException {
    return new AppException('VALIDATION_ERROR', { details, logContext });
  }
}
