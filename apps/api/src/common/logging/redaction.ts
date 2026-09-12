/**
 * Política de redaction dos logs (doc 18 §1 e doc 09 §1 "Integração SG").
 *
 * Duas camadas, de propósito:
 *  1. `PINO_REDACT_PATHS` — caminhos conhecidos (headers, corpo) removidos pelo próprio pino;
 *  2. `redactObject()` — varredura profunda por NOME de campo, usada em qualquer payload que a
 *     aplicação queira logar (respostas da API SG, erros de terceiros, metadados de job).
 *
 * A regra do projeto é dupla: nada de segredo (senha/token/authorization) e nada de PII
 * (cpf/cnpj/e-mail/telefone) sai em log de aplicação — auditoria de negócio vai para
 * `app_audit_log`, não para o Loki.
 */

export const REDACTED = '[REDACTED]';

/** Nomes de campo considerados sensíveis (comparação case-insensitive, sem acentos). */
export const SENSITIVE_FIELD_NAMES = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'senha',
  'novasenha',
  'passwordconfirmation',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'jwt',
  'secret',
  'secretciphertext',
  'clientsecret',
  'apikey',
  'api_key',
  'sessionsecret',
  'csrftoken',
  'x-csrf-token',
  'totp',
  'totpsecret',
  'masterkey',
  'privatekey',
  'cpf',
  'cnpj',
  'cpfcnpj',
  'documento',
  'email',
  'telefone',
  'celular',
  'endereco',
  'datanascimento',
  'chavenfe',
] as const;

const NORMALIZED_SENSITIVE = new Set<string>(SENSITIVE_FIELD_NAMES);

/** Marcas de acentuação combinantes (U+0300–U+036F), removidas após `normalize('NFD')`. */
const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  'g',
);

/** `Senha_Nova` → `senhanova`; permite casar variações de caixa/acentuação/separador. */
export function normalizeFieldName(name: string): string {
  return name
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

export function isSensitiveField(name: string): boolean {
  return NORMALIZED_SENSITIVE.has(normalizeFieldName(name));
}

/** Caminhos entregues ao pino (aceita curingas de 1 e 2 níveis). */
export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.senha',
  'req.body.totp',
  ...SENSITIVE_FIELD_NAMES.map((field) => `*.${field}`),
  ...SENSITIVE_FIELD_NAMES.map((field) => `*.*.${field}`),
];

const MAX_DEPTH = 8;

/**
 * Cópia profunda com campos sensíveis substituídos por `[REDACTED]`.
 * Estruturas cíclicas e profundidade excessiva são cortadas (log não é dump de memória).
 */
export function redactObject<T>(value: T, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[TRUNCATED]';

  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item, depth + 1, seen));
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    if (seen.has(objectValue)) return '[CIRCULAR]';
    seen.add(objectValue);

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(objectValue)) {
      output[key] = isSensitiveField(key) ? REDACTED : redactObject(item, depth + 1, seen);
    }
    return output;
  }

  return value;
}
