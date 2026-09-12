import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from '../../src/config/env.schema';

const ENV_EXAMPLE = resolve(__dirname, '../../../../.env.example');

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
 * O `.env.example` é a documentação executável do contrato de ambiente (doc 19 §3).
 * Se ele deixar de satisfazer o schema, o tutorial de instalação (doc 24 §2) quebra para quem
 * chegar amanhã — então isso é um teste, não um comentário.
 */
describe('.env.example', () => {
  it('existe e satisfaz o contrato de ambiente', () => {
    expect(existsSync(ENV_EXAMPLE)).toBe(true);

    const result = parseEnv(parseDotEnv(readFileSync(ENV_EXAMPLE, 'utf8')));
    if (!result.ok) {
      throw new Error(
        `.env.example inválido:\n${result.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`,
      );
    }
    expect(result.env.NODE_ENV).toBe('development');
  });

  it('não traz segredo real — todo valor sensível é claramente de desenvolvimento', () => {
    const values = parseDotEnv(readFileSync(ENV_EXAMPLE, 'utf8'));
    for (const field of ['SESSION_SECRET', 'CSRF_SECRET', 'PII_PEPPER'] as const) {
      expect(values[field]).toMatch(/dev_only|CHANGE_ME/);
    }
    expect(Buffer.from(values.MASTER_KEY_CURRENT ?? '', 'base64').toString('utf8')).toMatch(
      /dev_only|CHANGE_ME/,
    );
  });
});
