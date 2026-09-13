import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Acesso ao banco a partir dos testes E2E — só para **preparar** o estado.
 *
 * Nenhuma asserção é feita por aqui: quem verifica comportamento é o navegador. O banco serve
 * para colocar as contas do seed num ponto de partida conhecido, já que sessões duram 12 h e o
 * cadastro de MFA é permanente — sem isso, um teste herdaria o estado do anterior.
 */

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // Em dev as variáveis vivem no .env da raiz; no CI vêm do ambiente do job.
  const envPath = resolve(__dirname, '../.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = /^\s*DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
      if (match?.[1]) return match[1].replace(/^["']|["']$/g, '');
    }
  }

  throw new Error('DATABASE_URL não definida para os testes E2E');
}

let client: PrismaClient | null = null;

function prisma(): PrismaClient {
  client ??= new PrismaClient({ datasourceUrl: databaseUrl() });
  return client;
}

/** Devolve as contas do seed ao estado inicial: sem MFA, sem bloqueio e sem sessões abertas. */
export async function resetSeedAccounts(emails: string[]): Promise<void> {
  const db = prisma();
  const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return;

  await db.$transaction([
    db.session.deleteMany({ where: { userId: { in: ids } } }),
    db.totpRecoveryCode.deleteMany({ where: { userId: { in: ids } } }),
    db.passwordReset.deleteMany({ where: { userId: { in: ids } } }),
    db.user.updateMany({
      where: { id: { in: ids } },
      data: {
        totpEnabled: false,
        totpSecretCiphertext: null,
        totpKeyVersion: null,
        failedAttempts: 0,
        lockedUntil: null,
      },
    }),
  ]);
}

/**
 * Apaga as conexões com o ERP de todos os tenants de teste.
 *
 * A tela muda de "Senha" para "Nova senha" depois que existe credencial salva — sem zerar,
 * um cenário herdaria o estado do anterior e o teste passaria a medir a ordem de execução.
 */
export async function resetErpConnections(): Promise<void> {
  const db = prisma();
  const tenants = await db.tenant.findMany({ select: { id: true } });

  for (const tenant of tenants) {
    await db.$transaction(async (tx) => {
      // Dado de tenant: sem `app.tenant_id` fixado, a RLS recusa — inclusive para o teste.
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenant.id}'`);
      await tx.erpConnection.deleteMany({});
    });
  }
}

export async function closeDb(): Promise<void> {
  await client?.$disconnect();
  client = null;
}
