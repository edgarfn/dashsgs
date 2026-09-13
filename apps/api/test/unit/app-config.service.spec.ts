import { AppConfigService } from '../../src/config/app-config.service';
import { parseEnv, type Env } from '../../src/config/env.schema';

const SESSION_SECRET = 'sessao-super-secreta-de-40-caracteres-ok';
const CSRF_SECRET = 'csrf-super-secreto-de-40-caracteres-okay';
const PII_PEPPER = 'pepper-super-secreto-24c';
const MASTER_KEY = Buffer.alloc(32, 9).toString('base64');

function buildEnv(overrides: Record<string, string> = {}): Env {
  const result = parseEnv({
    NODE_ENV: 'staging',
    APP_URL: 'https://app.staging.dashsgs.com.br',
    API_URL: 'https://api.staging.dashsgs.com.br',
    PORT: '3001',
    APP_VERSION: 'sha-abc123',
    SESSION_SECRET,
    CSRF_SECRET,
    COOKIE_DOMAIN: 'staging.dashsgs.com.br',
    DATABASE_URL: 'postgresql://app_rw:pwd@db:5432/dashsgs',
    REDIS_URL: 'redis://cache:6379',
    MASTER_KEY_CURRENT: MASTER_KEY,
    PII_PEPPER,
    SMTP_URL: 'smtp://mail:587',
    MAIL_FROM: 'DashSGS <no-reply@dashsgs.com.br>',
    ...overrides,
  });
  if (!result.ok) throw new Error(`ambiente de teste inválido: ${JSON.stringify(result.issues)}`);
  return result.env;
}

describe('AppConfigService', () => {
  it('expõe a configuração já tipada e com os defaults do contrato', () => {
    const config = new AppConfigService(buildEnv());

    expect(config.nodeEnv).toBe('staging');
    expect(config.isProduction).toBe(false);
    expect(config.isDevelopment).toBe(false);
    expect(config.port).toBe(3001);
    expect(config.version).toBe('sha-abc123');
    expect(config.sg).toEqual({
      maxRps: 4,
      timeoutMs: 60_000,
      heavyTimeoutMs: 180_000,
      mock: false,
      allowInsecure: false,
      vpnCidr: '10.66.0.0/16',
    });
    expect(config.features).toEqual({ erpWrite: false, clientModule: false });
  });

  it('reconhece produção', () => {
    const config = new AppConfigService(
      buildEnv({
        NODE_ENV: 'production',
        APP_URL: 'https://app.dashsgs.com.br',
        API_URL: 'https://api.dashsgs.com.br',
      }),
    );
    expect(config.isProduction).toBe(true);
  });

  /**
   * O snapshot vai para o log de boot. Se um segredo escorregar para cá, ele passa a viver no
   * Loki e em qualquer cópia de log — exatamente o que o doc 18 §1 proíbe.
   */
  it('nunca expõe segredo no snapshot de boot', () => {
    const snapshot = JSON.stringify(new AppConfigService(buildEnv()).safeSnapshot());

    for (const segredo of [SESSION_SECRET, CSRF_SECRET, PII_PEPPER, MASTER_KEY, 'app_rw:pwd']) {
      expect(snapshot).not.toContain(segredo);
    }
    // Continua dizendo o que interessa para diagnosticar um boot.
    expect(snapshot).toContain('staging');
    expect(snapshot).toContain('sha-abc123');
  });
});
