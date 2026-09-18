import { randomUUID } from 'node:crypto';
import { type Role } from '@dashsgs/shared';
import { hash } from '@node-rs/argon2';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../../src/common/prisma/prisma.service';
import { TenantDatabase } from '../../../src/common/tenant';

/**
 * Fixtures de multi-tenancy: dois tenants completos, com filiais e membros, para que o
 * isolamento possa ser exercido de verdade (doc 08 §6).
 */

const TEST_ARGON2 = { memoryCost: 8_192, timeCost: 1, parallelism: 1 } as const;

export interface TenantFixtureUser {
  id: string;
  email: string;
  role: Role;
  filiaisAllowed: number[];
  membershipId: string;
}

export interface TenantFixture {
  id: string;
  slug: string;
  name: string;
  /** Marcas textuais exclusivas deste tenant — usadas para caçar vazamento em respostas. */
  marcas: string[];
  filiais: number[];
  users: Record<string, TenantFixtureUser>;
}

/**
 * Cria um tenant com filiais e membros. Cada tenant recebe um sufixo único, e os nomes das
 * filiais carregam esse sufixo: assim, encontrar a marca de um tenant na resposta do outro é
 * prova objetiva de vazamento.
 */
export async function createTenantFixture(
  app: INestApplication,
  options: {
    password: string;
    filiais?: number[];
    users: Array<{ chave: string; role: Role; filiaisAllowed?: number[] }>;
  },
): Promise<TenantFixture> {
  const prisma = app.get(PrismaService);
  const tenantDb = app.get(TenantDatabase);

  const sufixo = randomUUID().slice(0, 8);
  const filiais = options.filiais ?? [1, 2, 3];

  const tenant = await prisma.tenant.create({
    data: { name: `Rede ${sufixo}`, slug: `teste-${sufixo}`, plan: 'teste' },
  });

  await tenantDb.run(tenant.id, async (tx) => {
    for (const erpId of filiais) {
      await tx.erpFilial.create({
        data: {
          tenantId: tenant.id,
          erpId,
          razaoSocial: `Rede ${sufixo} Comercio LTDA ${erpId}`,
          nomeFantasia: `Loja ${sufixo}-${erpId}`,
          uf: 'SP',
        },
      });
    }
  });

  const passwordHash = await hash(options.password, TEST_ARGON2);
  const users: Record<string, TenantFixtureUser> = {};

  for (const definicao of options.users) {
    const email = `${definicao.chave}-${sufixo}@teste.local`;
    const user = await prisma.user.create({
      data: { email, name: `${definicao.chave} ${sufixo}`, passwordHash, status: 'active' },
    });
    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        role: definicao.role,
        filiaisAllowed: definicao.filiaisAllowed ?? [],
      },
    });

    users[definicao.chave] = {
      id: user.id,
      email,
      role: definicao.role,
      filiaisAllowed: definicao.filiaisAllowed ?? [],
      membershipId: membership.id,
    };
  }

  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    marcas: [
      tenant.id,
      tenant.slug,
      tenant.name,
      sufixo,
      ...Object.values(users).map((u) => u.email),
    ],
    filiais,
    users,
  };
}

/** Promove uma conta a operadora da plataforma (papel global — doc 07 §2). */
export async function makePlatformAdmin(app: INestApplication, userId: string): Promise<void> {
  await app.get(PrismaService).user.update({
    where: { id: userId },
    data: { platformAdmin: true },
  });
}

/** Procura qualquer marca de um tenant dentro de um payload — vazamento não passa despercebido. */
export function contemMarcaDe(payload: unknown, fixture: TenantFixture): string | null {
  const texto = JSON.stringify(payload ?? '');
  return fixture.marcas.find((marca) => marca.length > 6 && texto.includes(marca)) ?? null;
}

/** Remove os tenants e usuários criados pelas fixtures. */
export async function cleanupTenantFixtures(prisma: PrismaService): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { endsWith: '@teste.local' } } });
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: 'teste-' } } });
}

/**
 * "Hoje" no fuso do tenant — o mesmo cálculo que a API faz.
 *
 * Os testes usavam `new Date().toISOString().slice(0, 10)`, que é UTC. O produto usa o fuso do
 * tenant (`America/Sao_Paulo` nas fixtures), e entre 00h e 03h UTC os dois divergem: a suíte
 * inteira falhava por três horas todo dia, com mensagens do tipo "esperava 2026-09-18, veio
 * 2026-09-17" que não têm nada a ver com o que o cenário testa.
 *
 * Quem afirma coisas sobre "o dia corrente" precisa perguntar a data ao mesmo relógio que a
 * aplicação consulta.
 */
export const FUSO_DA_FIXTURE = 'America/Sao_Paulo';

export function hojeNoTenant(timeZone: string = FUSO_DA_FIXTURE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

/** Um dia relativo a hoje, também no fuso do tenant. `-1` = ontem. */
export function diaNoTenant(offsetDias: number, timeZone: string = FUSO_DA_FIXTURE): string {
  const base = new Date(`${hojeNoTenant(timeZone)}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDias);
  return base.toISOString().slice(0, 10);
}
