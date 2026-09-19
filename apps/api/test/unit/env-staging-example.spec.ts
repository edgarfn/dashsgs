import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from '../../src/config/env.schema';

const ENV_STAGING_EXAMPLE = resolve(__dirname, '../../../../.env.staging.example');

function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    result[match[1] as string] = (match[2] as string).replace(/^["']|["']$/g, '');
  }
  return result;
}

/**
 * `.env.staging.example` é o contrato de ambiente de staging/produção (doc 19 §3) — mas ao
 * contrário de `.env.example`, ele deve FALHAR como está: todo valor sensível é `CHANGE_ME` de
 * propósito, e é o próprio `envSchema` (a guarda de produção) que recusa o boot com ele. Este
 * teste prova as duas metades: que a recusa acontece pelo motivo certo — não por um erro de
 * digitação em outro campo escondendo o de verdade —, e que a ESTRUTURA do arquivo, fora os
 * placeholders, satisfaz o contrato de produção inteiro (https, CIDR, etc.).
 */
describe('.env.staging.example', () => {
  it('existe e tem NODE_ENV=production', () => {
    expect(existsSync(ENV_STAGING_EXAMPLE)).toBe(true);
    const values = parseDotEnv(readFileSync(ENV_STAGING_EXAMPLE, 'utf8'));
    expect(values.NODE_ENV).toBe('production');
  });

  it('como está, o boot recusa — CHANGE_ME pego pela guarda de produção (doc 09 §2)', () => {
    const values = parseDotEnv(readFileSync(ENV_STAGING_EXAMPLE, 'utf8'));
    const result = parseEnv(values);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const campos = result.issues.map((issue) => issue.path);
    for (const campo of ['SESSION_SECRET', 'CSRF_SECRET', 'PII_PEPPER', 'MASTER_KEY_CURRENT']) {
      expect(campos).toContain(campo);
    }
  });

  it('com segredos reais no lugar dos placeholders, a estrutura satisfaz o contrato inteiro', () => {
    const values = parseDotEnv(readFileSync(ENV_STAGING_EXAMPLE, 'utf8'));

    // Só os quatro campos que a guarda de sentinela confere (doc 09 §2) — o resto do arquivo
    // não deveria precisar de ajuste nenhum para passar; se precisar, é o arquivo que está errado.
    const preenchido: Record<string, string> = {
      ...values,
      SESSION_SECRET: randomBytes(48).toString('base64'),
      CSRF_SECRET: randomBytes(48).toString('base64'),
      PII_PEPPER: randomBytes(24).toString('base64'),
      MASTER_KEY_CURRENT: randomBytes(32).toString('base64'),
    };

    const result = parseEnv(preenchido);
    if (!result.ok) {
      throw new Error(
        '.env.staging.example, com segredos preenchidos, ainda não satisfaz o contrato de produção:\n' +
          result.issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n'),
      );
    }
    expect(result.env.NODE_ENV).toBe('production');
    expect(result.env.SG_MOCK).toBe(false);
    expect(result.env.ALLOW_INSECURE_ERP).toBe(false);
    expect(result.env.APP_URL.startsWith('https://')).toBe(true);
    expect(result.env.API_URL.startsWith('https://')).toBe(true);
  });
});
