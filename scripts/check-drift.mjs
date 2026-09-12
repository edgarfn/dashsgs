#!/usr/bin/env node
/**
 * Gate de drift (doc 11 §1, passo 8): o conjunto de migrações precisa produzir EXATAMENTE o
 * schema descrito em prisma/schema.prisma. Se alguém editar o schema sem gerar migração — ou
 * editar uma migração já aplicada — o CI para aqui, e não em produção.
 *
 * Uso: pnpm db:drift   (precisa de SHADOW_DATABASE_URL; em dev vem do .env)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** Em dev as variáveis vivem no .env; no CI vêm do ambiente do job. */
function loadDotEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

loadDotEnv();

const shadowUrl = process.env.SHADOW_DATABASE_URL;
if (!shadowUrl) {
  console.error(
    'SHADOW_DATABASE_URL não definida. O diff precisa de um banco descartável para aplicar\n' +
      'as migrações e comparar com o schema (ver .env.example).',
  );
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [
    resolve(ROOT, 'node_modules/prisma/build/index.js'),
    'migrate',
    'diff',
    '--from-migrations',
    resolve(ROOT, 'prisma/migrations'),
    '--to-schema-datamodel',
    resolve(ROOT, 'prisma/schema.prisma'),
    '--shadow-database-url',
    shadowUrl,
    '--exit-code',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

// prisma migrate diff: 0 = sem diferença, 2 = há diferença, 1 = erro.
if (result.status === 2) {
  console.error(
    '\nDrift detectado entre prisma/migrations e prisma/schema.prisma.\n' +
      'Gere a migração correspondente (pnpm db:migrate:dev --name <descricao>) em vez de\n' +
      'editar migrações já aplicadas — o histórico precisa reproduzir o schema (doc 11 §3).',
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
