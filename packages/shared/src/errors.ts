/**
 * Catálogo de códigos de erro da API interna (doc 23 — "Convenções de erro").
 * O código é estável e público; a mensagem é segura (nunca vaza detalhe interno — doc 09 §1).
 */
export const ERROR_CODES = [
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_MFA_REQUIRED',
  'AUTH_LOCKED',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'ERP_UNREACHABLE',
  'ERP_CREDENTIALS_INVALID',
  'ERP_ROUTE_FORBIDDEN',
  'EXPORT_LIMIT',
  'CONFLICT',
  'INTERNAL',
  'SERVICE_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Mapeamento código → HTTP (doc 23). Fonte única para API e testes de contrato. */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_MFA_REQUIRED: 401,
  AUTH_LOCKED: 423,
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  ERP_UNREACHABLE: 502,
  ERP_CREDENTIALS_INVALID: 502,
  ERP_ROUTE_FORBIDDEN: 403,
  EXPORT_LIMIT: 429,
  CONFLICT: 409,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
};

/** Corpo padronizado de erro — idêntico em toda a API (doc 23 / doc 09 §1). */
export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  correlationId: string;
  timestamp: string;
  /** Detalhes de validação: apenas caminho + regra, nunca o valor enviado. */
  details?: Array<{ path: string; rule: string }>;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
