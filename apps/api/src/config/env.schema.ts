import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Contrato de ambiente do backend (doc 19 §3).
 * Este é o ÚNICO lugar do código autorizado a ler `process.env` (o lint impede o resto — doc 24 §6).
 * Regra: falhar rápido e alto no boot; nunca "assumir um padrão razoável" para segredo.
 */

const base64Bytes = (bytes: number, field: string) =>
  z
    .string()
    .min(1, `${field} é obrigatório`)
    .refine((value) => {
      try {
        return Buffer.from(value, 'base64').length === bytes;
      } catch {
        return false;
      }
    }, `${field} deve ser base64 de exatamente ${bytes} bytes (gere com: openssl rand -base64 ${bytes})`);

const boolFromEnv = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1');

const postgresUrl = z
  .string()
  .refine(
    (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'deve ser uma URL postgresql://',
  );

/** Valores-sentinela que só existem em desenvolvimento — proibidos em produção. */
const DEV_SENTINELS = ['dev_only', 'CHANGE_ME', 'changeme'];

const hasDevSentinel = (value: string | undefined) =>
  !!value && DEV_SENTINELS.some((sentinel) => value.includes(sentinel));

export const envSchema = z
  .object({
    // --- App ---
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    APP_URL: z.string().url(),
    API_URL: z.string().url(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Preenchido pelo pipeline com a tag/digest do artefato (doc 11 §1). */
    APP_VERSION: z.string().min(1).default('0.1.0-dev'),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET precisa de 32+ caracteres'),
    CSRF_SECRET: z.string().min(32, 'CSRF_SECRET precisa de 32+ caracteres'),
    COOKIE_DOMAIN: z.string().min(1),

    // --- Banco / Cache ---
    DATABASE_URL: postgresUrl,
    DATABASE_URL_MIGRATOR: postgresUrl.optional(),
    SHADOW_DATABASE_URL: postgresUrl.optional(),
    REDIS_URL: z.string().refine((v) => /^rediss?:\/\//.test(v), 'deve ser uma URL redis://'),

    // --- Criptografia (doc 09 §2) ---
    MASTER_KEY_CURRENT: base64Bytes(32, 'MASTER_KEY_CURRENT'),
    MASTER_KEY_PREVIOUS: base64Bytes(32, 'MASTER_KEY_PREVIOUS').optional(),
    MASTER_KEY_VERSION: z.coerce.number().int().min(1).default(1),
    PII_PEPPER: z.string().min(16, 'PII_PEPPER precisa de 16+ caracteres'),

    // --- E-mail ---
    SMTP_URL: z.string().min(1),
    MAIL_FROM: z.string().min(1),

    // --- Observabilidade ---
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional().or(z.literal('')),
    SENTRY_DSN: z.string().optional().or(z.literal('')),
    METRICS_ENABLED: boolFromEnv(true),

    // --- Integração SG (doc 12) ---
    SG_DEFAULT_MAX_RPS: z.coerce.number().positive().max(50).default(4),
    // Máximo aceito por endpoint é pergunta aberta à SG (doc 34 Q4): fica configurável para que
    // a resposta vire mudança de ambiente, não de código.
    SG_PAGE_SIZE: z.coerce.number().int().min(10).max(5000).default(500),
    SG_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
    SG_HEAVY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(900_000).default(180_000),
    ALLOW_INSECURE_ERP: boolFromEnv(false),
    // Faixa do WireGuard da plataforma: é a única rede privada que o guarda anti-SSRF aceita,
    // e só para conexões com tls_mode=vpn (runbook 22 §7).
    SG_VPN_CIDR: z
      .string()
      .regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, 'informe um CIDR IPv4, ex.: 10.66.0.0/16')
      .default('10.66.0.0/16'),
    SG_MOCK: boolFromEnv(false),

    // --- Sincronização (doc 14) ---
    /** Jobs simultâneos por processo de worker. O teto real é o ERP da loja, não a nossa CPU. */
    SYNC_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    /** Só um processo registra as cadências; os demais apenas consomem a fila. */
    SYNC_SCHEDULER_ENABLED: boolFromEnv(true),
    /** Porta onde o worker expõe /metrics e /healthz (ele não atende a API). */
    WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(3002),

    // --- Feature flags ---
    FEATURE_ERP_WRITE: boolFromEnv(false),
    FEATURE_CLIENT_MODULE: boolFromEnv(false),
  })
  // Produção não aceita atalhos de desenvolvimento (doc 09 §2 / doc 11 §3 "Ambientes").
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    if (env.ALLOW_INSECURE_ERP) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ALLOW_INSECURE_ERP'],
        message: 'proibido em produção: a API SG só pode ser acessada por HTTPS ou VPN (doc 09 §1)',
      });
    }
    if (env.SG_MOCK) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SG_MOCK'],
        message: 'proibido em produção: mocks da API SG são exclusivos de dev/teste',
      });
    }
    for (const field of ['APP_URL', 'API_URL'] as const) {
      if (!env[field].startsWith('https://')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'produção exige https://',
        });
      }
    }
    const secretFields = [
      'SESSION_SECRET',
      'CSRF_SECRET',
      'PII_PEPPER',
      'MASTER_KEY_CURRENT',
    ] as const;
    for (const field of secretFields) {
      if (hasDevSentinel(env[field])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'valor de desenvolvimento detectado; use o segredo do cofre (doc 09 §2)',
        });
      }
    }
    if (env.DATABASE_URL.includes('localhost')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'produção não usa banco local; aponte para o banco gerenciado com TLS',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export interface EnvIssue {
  path: string;
  message: string;
}

export type EnvParseResult = { ok: true; env: Env } | { ok: false; issues: EnvIssue[] };

/** Valida um objeto de ambiente sem tocar em `process` — usado no boot e nos testes. */
export function parseEnv(source: Record<string, string | undefined>): EnvParseResult {
  const result = envSchema.safeParse(source);
  if (result.success) return { ok: true, env: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(raiz)',
      message: issue.message,
    })),
  };
}

/**
 * Conveniência de desenvolvimento: carrega o `.env` da raiz do monorepo quando existir.
 *
 * Variáveis já presentes no processo têm precedência — e em produção o arquivo é ignorado por
 * completo: lá a configuração vem do ambiente/secret manager (12-factor, doc 19 §3).
 */
export function loadDotEnvFile(
  target: NodeJS.ProcessEnv,
  envPath: string = resolve(__dirname, '../../../../.env'),
): void {
  if (target.NODE_ENV === 'production') return;
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    if (target[key] !== undefined) continue;
    target[key] = (match[2] as string).replace(/^["']|["']$/g, '');
  }
}

/**
 * Lê e valida o ambiente do processo. Em caso de falha, imprime o relatório e encerra com
 * código 1 — o processo nunca sobe parcialmente configurado (E1-04).
 */
export function loadEnvOrExit(source: Record<string, string | undefined> = process.env): Env {
  if (source === process.env) loadDotEnvFile(process.env);
  const result = parseEnv(source);
  if (result.ok) return result.env;

  const lines = result.issues.map((issue) => `  x ${issue.path}: ${issue.message}`);
  process.stderr.write(
    [
      '',
      'DashSGS - configuracao de ambiente invalida. O processo nao sera iniciado.',
      ...lines,
      '',
      'Contrato completo em docs/19-deployment.md §3 e em .env.example.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
