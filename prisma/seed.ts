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

/** Mesmos parâmetros do doc 06 §Senhas usados pela aplicação (HashingService). */
const ARGON2_OPTIONS = { memoryCost: 65_536, timeCost: 3, parallelism: 4 } as const;

const DEMO_TENANT = { slug: 'demo', name: 'Rede Demo (sintética)' };
/** Segundo tenant: o isolamento fica visível já no ambiente de desenvolvimento. */
const VIZINHO_TENANT = { slug: 'vizinho', name: 'Rede Vizinha (sintética)' };

type SeedRole = 'owner' | 'manager' | 'analyst';

const DEMO_USERS: Array<{ email: string; name: string; role: SeedRole; filiais: number[] }> = [
  { email: 'owner@demo.local', name: 'Ana Owner', role: 'owner', filiais: [] },
  { email: 'gerente@demo.local', name: 'Bruno Gerente', role: 'manager', filiais: [] },
  // Recorte de filiais: exercita `filiais_allowed` fim-a-fim (doc 07 §4.2).
  { email: 'analista@demo.local', name: 'Carla Analista', role: 'analyst', filiais: [1, 2] },
];

const VIZINHO_USERS: Array<{ email: string; name: string; role: SeedRole; filiais: number[] }> = [
  { email: 'owner@vizinho.local', name: 'Davi Owner', role: 'owner', filiais: [] },
];

const PLATFORM_ADMIN = { email: 'plataforma@dashsgs.local', name: 'Equipe DashSGS' };

/** Filiais sintéticas. A sincronização real com a API SG chega na Fase 6 (E5-02). */
const FILIAIS = [
  { erpId: 1, sufixo: 'Matriz', fantasia: 'Centro', uf: 'SP' },
  { erpId: 2, sufixo: 'Filial 2', fantasia: 'Zona Sul', uf: 'SP' },
  { erpId: 3, sufixo: 'Filial 3', fantasia: 'Litoral', uf: 'SP' },
  { erpId: 4, sufixo: 'Filial 4', fantasia: 'Interior', uf: 'MG' },
];

function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}

async function upsertTenant(definition: { slug: string; name: string }) {
  return prisma.tenant.upsert({
    where: { slug: definition.slug },
    update: { name: definition.name },
    create: { id: randomUUID(), ...definition, plan: 'dev' },
  });
}

async function upsertMember(
  tenantId: string,
  passwordHash: string,
  member: { email: string; name: string; role: SeedRole; filiais: number[] },
) {
  const user = await prisma.user.upsert({
    where: { email: member.email },
    update: { name: member.name, passwordHash, status: 'active' },
    create: { email: member.email, name: member.name, passwordHash, status: 'active' },
  });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    update: { role: member.role, filiaisAllowed: member.filiais },
    create: { userId: user.id, tenantId, role: member.role, filiaisAllowed: member.filiais },
  });
}

/**
 * Filiais são dado de TENANT: a RLS estrita recusa a escrita sem `app.tenant_id` fixado
 * (doc 08 §3). O seed abre o contexto exatamente como a aplicação faz.
 */
async function seedFiliais(tenantId: string, marca: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);

    for (const filial of FILIAIS) {
      const razaoSocial = `${marca} Supermercados LTDA — ${filial.sufixo}`;
      const nomeFantasia = `${marca} ${filial.fantasia}`;
      await tx.erpFilial.upsert({
        where: { tenantId_erpId: { tenantId, erpId: filial.erpId } },
        update: { razaoSocial, nomeFantasia, uf: filial.uf },
        create: { tenantId, erpId: filial.erpId, razaoSocial, nomeFantasia, uf: filial.uf },
      });
    }
  });
}

async function main(): Promise<void> {
  const password = process.env.SEED_PASSWORD ?? generatePassword();
  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const demo = await upsertTenant(DEMO_TENANT);
  const vizinho = await upsertTenant(VIZINHO_TENANT);

  for (const member of DEMO_USERS) await upsertMember(demo.id, passwordHash, member);
  for (const member of VIZINHO_USERS) await upsertMember(vizinho.id, passwordHash, member);

  await seedFiliais(demo.id, 'Demo');
  await seedFiliais(vizinho.id, 'Vizinha');

  // Conta de operação da plataforma: papel global, sem membership em tenant nenhum (doc 07 §2).
  await prisma.user.upsert({
    where: { email: PLATFORM_ADMIN.email },
    update: { name: PLATFORM_ADMIN.name, passwordHash, status: 'active', platformAdmin: true },
    create: {
      email: PLATFORM_ADMIN.email,
      name: PLATFORM_ADMIN.name,
      passwordHash,
      status: 'active',
      platformAdmin: true,
    },
  });

  console.log('');
  console.log('Seed concluído (dados sintéticos).');
  console.log(`  tenant : ${demo.name} (${demo.slug}) — ${FILIAIS.length} filiais`);
  console.log(`  tenant : ${vizinho.name} (${vizinho.slug}) — ${FILIAIS.length} filiais`);
  for (const user of [...DEMO_USERS, ...VIZINHO_USERS]) {
    const recorte = user.filiais.length > 0 ? ` — filiais ${user.filiais.join(', ')}` : '';
    console.log(`  usuário: ${user.email} — papel ${user.role}${recorte}`);
  }
  console.log(`  usuário: ${PLATFORM_ADMIN.email} — administração da plataforma`);
  console.log(`  senha  : ${password}`);
  console.log('');
  console.log('  O papel owner exige cadastrar MFA no primeiro acesso (doc 06 §MFA).');
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
