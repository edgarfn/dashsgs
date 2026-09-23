import { parseEnv, TURNSTILE_TEST_SECRET_ALWAYS_PASS } from '../../src/config/env.schema';

const validEnv = (): Record<string, string> => ({
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  PORT: '3001',
  SESSION_SECRET: 'x'.repeat(40),
  CSRF_SECRET: 'y'.repeat(40),
  COOKIE_DOMAIN: 'localhost',
  DATABASE_URL: 'postgresql://app_rw:pwd@localhost:5432/dashsgs',
  REDIS_URL: 'redis://localhost:6379',
  MASTER_KEY_CURRENT: Buffer.alloc(32, 1).toString('base64'),
  MASTER_KEY_VERSION: '1',
  PII_PEPPER: 'p'.repeat(24),
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'DashSGS <no-reply@dashsgs.local>',
});

const issuePaths = (result: ReturnType<typeof parseEnv>): string[] =>
  result.ok ? [] : result.issues.map((issue) => issue.path);

/** E1-04: o boot falha com env inválida — e falha dizendo exatamente o quê. */
describe('contrato de ambiente', () => {
  it('aceita a configuração de desenvolvimento com os defaults documentados', () => {
    const result = parseEnv(validEnv());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.PORT).toBe(3001);
    expect(result.env.SG_DEFAULT_MAX_RPS).toBe(4);
    expect(result.env.METRICS_ENABLED).toBe(true);
    expect(result.env.FEATURE_ERP_WRITE).toBe(false);
    expect(result.env.TURNSTILE_SECRET_KEY).toBe(TURNSTILE_TEST_SECRET_ALWAYS_PASS);
  });

  it('recusa segredo curto e chave mestra fora de 32 bytes', () => {
    const result = parseEnv({
      ...validEnv(),
      SESSION_SECRET: 'curto',
      MASTER_KEY_CURRENT: Buffer.alloc(16, 1).toString('base64'),
    });
    expect(result.ok).toBe(false);
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining(['SESSION_SECRET', 'MASTER_KEY_CURRENT']),
    );
  });

  it('recusa URLs de banco e cache fora do protocolo esperado', () => {
    const result = parseEnv({
      ...validEnv(),
      DATABASE_URL: 'mysql://localhost:3306/dashsgs',
      REDIS_URL: 'http://localhost:6379',
    });
    expect(issuePaths(result)).toEqual(expect.arrayContaining(['DATABASE_URL', 'REDIS_URL']));
  });

  it('exige variáveis obrigatórias em vez de inventar padrão', () => {
    const { SESSION_SECRET: _s, DATABASE_URL: _d, ...incomplete } = validEnv();
    expect(issuePaths(parseEnv(incomplete))).toEqual(
      expect.arrayContaining(['SESSION_SECRET', 'DATABASE_URL']),
    );
  });

  describe('produção', () => {
    const prodEnv = (): Record<string, string> => ({
      ...validEnv(),
      NODE_ENV: 'production',
      APP_URL: 'https://app.dashsgs.com.br',
      API_URL: 'https://api.dashsgs.com.br',
      DATABASE_URL: 'postgresql://app_rw:pwd@db.interna:5432/dashsgs?sslmode=require',
      TURNSTILE_SECRET_KEY: '0x'.repeat(20),
    });

    it('aceita uma configuração de produção coerente', () => {
      expect(parseEnv(prodEnv()).ok).toBe(true);
    });

    it('bloqueia mocks da API SG em produção', () => {
      const result = parseEnv({ ...prodEnv(), SG_MOCK: 'true' });
      expect(issuePaths(result)).toContain('SG_MOCK');
    });

    // Decisão de produto (22/09/2026): a integração da SG com este tenant é HTTP puro, sem
    // HTTPS do lado do ERP — confirmado com o suporte deles. Risco aceito, não removido em
    // silêncio (doc 09 §1, doc 32 "HTTP público p/ ERP").
    it('aceita ALLOW_INSECURE_ERP em produção (decisão de produto, doc 09 §1)', () => {
      const result = parseEnv({ ...prodEnv(), ALLOW_INSECURE_ERP: 'true' });
      expect(result.ok).toBe(true);
    });

    it('bloqueia http:// nas URLs públicas e banco local', () => {
      const result = parseEnv({
        ...prodEnv(),
        APP_URL: 'http://app.dashsgs.com.br',
        DATABASE_URL: 'postgresql://app_rw:pwd@localhost:5432/dashsgs',
      });
      expect(issuePaths(result)).toEqual(expect.arrayContaining(['APP_URL', 'DATABASE_URL']));
    });

    it('bloqueia segredo de desenvolvimento promovido sem querer', () => {
      const result = parseEnv({ ...prodEnv(), CSRF_SECRET: `dev_only_${'z'.repeat(40)}` });
      expect(issuePaths(result)).toContain('CSRF_SECRET');
    });

    it('bloqueia a chave de teste do Turnstile (sempre aprova) em produção', () => {
      const result = parseEnv({
        ...prodEnv(),
        TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_ALWAYS_PASS,
      });
      expect(issuePaths(result)).toContain('TURNSTILE_SECRET_KEY');
    });
  });
});
