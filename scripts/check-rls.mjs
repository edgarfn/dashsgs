#!/usr/bin/env node
/**
 * Gate de isolamento (doc 08 §6.3): nenhuma tabela com `tenant_id` pode existir sem RLS
 * habilitada, forçada e com política.
 *
 * Roda no CI depois das migrações e serve também de verificação pontual em produção — é a
 * pergunta "o banco está protegido?" respondida em um comando.
 *
 * Uso: pnpm db:rls-check
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const ROOT = resolve(import.meta.dirname, '..');

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const envPath = resolve(ROOT, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = /^\s*DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
      if (match?.[1]) return match[1].replace(/^["']|["']$/g, '');
    }
  }

  console.error('DATABASE_URL não definida.');
  process.exit(2);
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });

try {
  const lacunas = await prisma.$queryRaw`
    SELECT table_name, rls_enabled, rls_forced, policy_count FROM app_rls_gaps()
  `;

  if (lacunas.length > 0) {
    console.error('\nTabelas com tenant_id desprotegidas:\n');
    for (const lacuna of lacunas) {
      console.error(
        `  ✗ ${lacuna.table_name}: rls=${lacuna.rls_enabled} force=${lacuna.rls_forced} políticas=${lacuna.policy_count}`,
      );
    }
    console.error(
      [
        '',
        'Toda tabela de dado de tenant precisa chamar o template na própria migração:',
        "  CALL app_enable_tenant_rls('minha_tabela');",
        '',
        'Tabelas lidas antes de existir tenant no contexto (fluxo de identidade) usam',
        "  CALL app_enable_identity_rls('minha_tabela');",
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  const [{ total }] = await prisma.$queryRaw`
    SELECT count(*)::int AS total
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      )
  `;

  console.log(`RLS ok: ${total} tabela(s) com tenant_id, todas com política forçada.`);
} finally {
  await prisma.$disconnect();
}
