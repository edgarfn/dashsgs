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

/**
 * Chave de teste oficial da Cloudflare para o Turnstile: sempre aprova, sem precisar de conta
 * real (doc do Cloudflare, "Testing"). É o default fora de produção — mesmo raciocínio do
 * `SG_MOCK`: atalho de dev, banido no boot quando `NODE_ENV=production` (ver superRefine abaixo).
 */
export const TURNSTILE_TEST_SECRET_ALWAYS_PASS = '1x0000000000000000000000000000000AA';

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

    // --- Anti-automação (Cloudflare Turnstile na tela de login — doc 06) ---
    TURNSTILE_SECRET_KEY: z.string().min(1).default(TURNSTILE_TEST_SECRET_ALWAYS_PASS),

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
    // Faixas do WireGuard da plataforma: as únicas redes privadas que o guarda anti-SSRF aceita,
    // e só para conexões com tls_mode=vpn (runbook 22 §7). Aceita lista separada por vírgula —
    // uma instalação pode acabar com mais de um túnel, e um só CIDR global obrigaria mudar
    // código para atender o segundo (doc 34 Q1).
    SG_VPN_CIDR: z
      .string()
      .refine(
        (valor) =>
          valor
            .split(',')
            .map((faixa) => faixa.trim())
            .filter(Boolean)
            .every((faixa) => /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(faixa)),
        'informe um ou mais CIDR IPv4 separados por vírgula, ex.: 10.66.0.0/16,10.67.0.0/16',
      )
      .default('10.66.0.0/16'),
    // Prefixo aplicado a TODAS as rotas da API SG. A SG não confirmou se o `/public` do SG Cloud
    // vale só para a autorização ou para a API inteira (doc 34 Q5); vazio preserva o
    // comportamento observado na homologação, e cada tenant pode sobrescrever.
    SG_API_PATH_PREFIX: z
      .string()
      .regex(/^(\/[A-Za-z0-9._~-]+)*$/, 'use um prefixo de caminho, ex.: /public')
      .default(''),
    // Formato do header Authorization quando ainda não se sabe qual a instalação aceita
    // (doc 34 Q2). O cliente descobre sozinho no primeiro 401 e grava o que funcionou.
    SG_AUTH_HEADER_MODE: z.enum(['raw', 'bearer']).default('raw'),
    // Piso da degradação automática de página: abaixo disso o problema não é tamanho de página,
    // e insistir só multiplicaria chamadas (doc 34 Q4).
    SG_PAGE_SIZE_MIN: z.coerce.number().int().min(1).max(1000).default(50),
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
      'TURNSTILE_SECRET_KEY',
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
    if (env.TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET_ALWAYS_PASS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TURNSTILE_SECRET_KEY'],
        message:
          'proibido em produção: chave de teste do Turnstile (sempre aprova) — use o segredo real do Cloudflare',
      });
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
