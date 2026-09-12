/**
 * Seed de desenvolvimento (E1-03). Dados 100% sintéticos — é proibido semear com dado real de
 * cliente (doc 10 / doc 17 §1).
 *
 * Uso: pnpm db:seed
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Parâmetros Argon2id recomendados (doc 06): memória 19 MiB, 2 iterações, paralelismo 1. */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

const DEMO_TENANT = { slug: 'demo', name: 'Rede Demo (sintética)' };
const DEMO_USERS = [
  { email: 'owner@demo.local', name: 'Ana Owner', role: 'owner' as const },
  { email: 'gerente@demo.local', name: 'Bruno Gerente', role: 'manager' as const },
  { email: 'analista@demo.local', name: 'Carla Analista', role: 'analyst' as const },
];

function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}

async function main(): Promise<void> {
  const password = process.env.SEED_PASSWORD ?? generatePassword();
  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const tenant = await prisma.tenant.upsert({
    where: { slug: DEMO_TENANT.slug },
    update: { name: DEMO_TENANT.name },
    create: { id: randomUUID(), ...DEMO_TENANT, plan: 'dev' },
  });

  for (const demoUser of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: demoUser.email },
      update: { name: demoUser.name, passwordHash, status: 'active' },
      create: {
        email: demoUser.email,
        name: demoUser.name,
        passwordHash,
        status: 'active',
      },
    });

    await prisma.membership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
      update: { role: demoUser.role },
      create: { userId: user.id, tenantId: tenant.id, role: demoUser.role },
    });
  }

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      action: 'seed.executed',
      resourceType: 'tenant',
      resourceId: tenant.slug,
      result: 'success',
      changes: { users: DEMO_USERS.map((user) => user.email) },
    },
  });

  console.log('');
  console.log('Seed concluído (dados sintéticos).');
  console.log(`  tenant : ${tenant.name} (${tenant.slug})`);
  for (const user of DEMO_USERS) console.log(`  usuário: ${user.email} — papel ${user.role}`);
  console.log(`  senha  : ${password}`);
  console.log('');
  console.log('  E-mails de convite/reset aparecem no Mailpit: http://localhost:8025');
  console.log('');
}

main()
  .catch((error: unknown) => {
    console.error('Falha no seed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
