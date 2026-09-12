/**
 * Ambiente dos testes de integração.
 *
 * Precedência: variáveis já exportadas (CI) > `.env` da raiz (dev) > defaults abaixo.
 * Os valores são sintéticos e apontam para o compose de desenvolvimento — é proibido rodar
 * testes contra ambiente real (doc 11 §3, doc 17 §1).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadRootDotEnv(): void {
  const envPath = resolve(__dirname, '../../../.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    if (process.env[key]) continue;
    process.env[key] = (match[2] as string).replace(/^["']|["']$/g, '');
  }
}

loadRootDotEnv();

const defaults: Record<string, string> = {
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  PORT: '3099',
  LOG_LEVEL: 'error',
  SESSION_SECRET: 'test_session_secret_test_session_secret_32',
  CSRF_SECRET: 'test_csrf_secret_test_csrf_secret_32chars',
  COOKIE_DOMAIN: 'localhost',
  DATABASE_URL: 'postgresql://app_rw:dev_only_password@localhost:5432/dashsgs?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  MASTER_KEY_CURRENT: Buffer.alloc(32, 7).toString('base64'),
  MASTER_KEY_VERSION: '1',
  PII_PEPPER: 'test_pepper_test_pepper_16',
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'DashSGS <test@dashsgs.local>',
  METRICS_ENABLED: 'true',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}

// O ambiente de teste é sempre `test`, mesmo que o .env local diga outra coisa.
process.env.NODE_ENV = 'test';
