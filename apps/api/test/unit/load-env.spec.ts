import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { loadDotEnvFile, loadEnvOrExit } from '../../src/config/env.schema';

const validEnv = (): Record<string, string> => ({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  SESSION_SECRET: 'x'.repeat(40),
  CSRF_SECRET: 'y'.repeat(40),
  COOKIE_DOMAIN: 'localhost',
  DATABASE_URL: 'postgresql://app_rw:pwd@localhost:5432/dashsgs',
  REDIS_URL: 'redis://localhost:6379',
  MASTER_KEY_CURRENT: Buffer.alloc(32, 1).toString('base64'),
  PII_PEPPER: 'p'.repeat(24),
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'DashSGS <no-reply@dashsgs.local>',
});

/**
 * E1-04, critério de aceite: "boot falha com env inválida".
 * O processo tem de MORRER — não logar um aviso e seguir com metade da configuração.
 */
describe('loadEnvOrExit', () => {
  let exitSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => jest.restoreAllMocks());

  it('devolve o ambiente tipado quando a configuração é válida', () => {
    const env = loadEnvOrExit(validEnv());
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(3001);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('encerra com código 1 e relata cada problema quando a configuração é inválida', () => {
    const { MAIL_FROM: _omitido, ...incompleto } = validEnv();
    const invalido = { ...incompleto, SESSION_SECRET: 'curto' };

    expect(() => loadEnvOrExit(invalido)).toThrow('process.exit(1)');

    const relatorio = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(relatorio).toContain('SESSION_SECRET');
    expect(relatorio).toContain('MAIL_FROM');
    // O relatório aponta o contrato, para quem estiver subindo o ambiente pela primeira vez.
    expect(relatorio).toContain('19-deployment.md');
  });

  it('não imprime o valor das variáveis no relatório de erro', () => {
    const segredo = 'senha-real-que-nao-pode-vazar';
    expect(() =>
      loadEnvOrExit({ ...validEnv(), DATABASE_URL: `mysql://user:${segredo}@host/db` }),
    ).toThrow('process.exit(1)');

    const relatorio = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(relatorio).toContain('DATABASE_URL');
    expect(relatorio).not.toContain(segredo);
  });
});

describe('loadDotEnvFile', () => {
  const tmpFile = resolve(tmpdir(), `dashsgs-env-${randomUUID()}.env`);

  afterEach(() => {
    if (existsSync(tmpFile)) rmSync(tmpFile);
  });

  it('preenche apenas as variáveis ausentes, respeitando o que já veio do ambiente', () => {
    writeFileSync(
      tmpFile,
      [
        '# comentário ignorado',
        'LOG_LEVEL=debug',
        'MAIL_FROM="DashSGS <dev@local>"',
        'JA_DEFINIDA=do-arquivo',
        'linha invalida',
      ].join('\n'),
    );

    const target: NodeJS.ProcessEnv = { NODE_ENV: 'development', JA_DEFINIDA: 'do-ambiente' };
    loadDotEnvFile(target, tmpFile);

    expect(target.LOG_LEVEL).toBe('debug');
    expect(target.MAIL_FROM).toBe('DashSGS <dev@local>');
    // Precedência: ambiente > arquivo (12-factor).
    expect(target.JA_DEFINIDA).toBe('do-ambiente');
  });

  it('ignora o arquivo por completo em produção', () => {
    writeFileSync(tmpFile, 'LOG_LEVEL=debug');
    const target: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    loadDotEnvFile(target, tmpFile);
    expect(target.LOG_LEVEL).toBeUndefined();
  });

  it('não quebra quando o arquivo não existe', () => {
    const target: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
    expect(() => loadDotEnvFile(target, resolve(tmpdir(), 'nao-existe.env'))).not.toThrow();
  });
});
