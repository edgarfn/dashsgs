import { randomUUID } from 'node:crypto';
import { API_PREFIX, type Role } from '@dashsgs/shared';
import { hash } from '@node-rs/argon2';
import { CookieAccessInfo } from 'cookiejar';
import type { INestApplication } from '@nestjs/common';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { PrismaService } from '../../../src/common/prisma/prisma.service';
import { RedisService } from '../../../src/common/redis/redis.service';

/**
 * Apoio dos testes de integração de autenticação.
 *
 * Tudo aqui usa dados sintéticos e sufixos previsíveis (`@teste.local`, slug `teste-…`) para que
 * a limpeza no fim seja cirúrgica e não encoste em nada do seed de desenvolvimento (doc 17 §1).
 */

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';
/** Argon2 barato: estes usuários existem por milissegundos, e o custo real é testado na unidade. */
const TEST_ARGON2 = { memoryCost: 8_192, timeCost: 1, parallelism: 1 } as const;

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@teste.local`;
}

interface CookieLike {
  name: string;
  value: string;
}

function cookiesOf(agent: TestAgent): CookieLike[] {
  // O agente do supertest guarda os cookies num jar do pacote `cookiejar`.
  const jar = (agent as unknown as { jar?: { getCookies: (access: unknown) => CookieLike[] } }).jar;
  if (!jar) return [];
  return jar.getCookies(CookieAccessInfo.All) ?? [];
}

function cookieValue(agent: TestAgent, name: string): string {
  return cookiesOf(agent).find((cookie) => cookie.name === name)?.value ?? '';
}

/** Agente com cookie jar próprio — cada um representa um navegador diferente. */
export function agentFor(app: INestApplication): TestAgent {
  return request.agent(app.getHttpServer());
}

agentFor.lastCsrf = (agent: TestAgent): string => cookieValue(agent, 'dashsgs_csrf');
agentFor.lastSession = (agent: TestAgent): string => cookieValue(agent, 'dashsgs_session');

export function totpFor(secretBase32: string, email: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: 'DashSGS',
    label: email,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export interface TestAccount {
  tenant: { id: string; slug: string; name: string };
  user: { id: string; email: string };
  /** Presente quando `withMfa` foi pedido: o segredo TOTP em base32. */
  secret?: string;
  recoveryCodes?: string[];
}

/**
 * Cria tenant + usuário com o papel pedido. Com `withMfa`, o TOTP é cadastrado pelo próprio
 * fluxo da API — nada de escrever segredo cifrado direto no banco, que mascararia bugs do fluxo.
 */
export async function createTenantWithOwner(
  app: INestApplication,
  options: { role: Role; password: string; withMfa?: boolean },
): Promise<TestAccount> {
  const prisma = app.get(PrismaService);
  const suffix = randomUUID().slice(0, 8);
  const email = uniqueEmail(options.role);

  const tenant = await prisma.tenant.create({
    data: { name: `Teste ${suffix}`, slug: `teste-${suffix}`, plan: 'teste' },
  });
  const user = await prisma.user.create({
    data: {
      email,
      name: `Usuário ${suffix}`,
      passwordHash: await hash(options.password, TEST_ARGON2),
      status: 'active',
    },
  });
  await prisma.membership.create({
    data: { userId: user.id, tenantId: tenant.id, role: options.role },
  });

  const account: TestAccount = {
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    user: { id: user.id, email: user.email },
  };

  if (options.withMfa) {
    const agent = agentFor(app);
    await agent.post(`${API_PREFIX}/auth/login`).send({ email, password: options.password });
    const csrf = agentFor.lastCsrf(agent);

    const setup = await agent.post(`${API_PREFIX}/auth/mfa/setup`).set('x-csrf-token', csrf);
    const secret = setup.body.secret as string;
    const enabled = await agent
      .post(`${API_PREFIX}/auth/mfa/enable`)
      .set('x-csrf-token', csrf)
      .send({ totp: totpFor(secret, email).generate() });

    account.secret = secret;
    account.recoveryCodes = enabled.body.recoveryCodes as string[];
  }

  return account;
}

/**
 * Faz login completo. Conclui o MFA quando a conta já tem segredo (`secret`) ou cadastra um
 * na hora (`enrollMfa`) — o que a tela de enrollment faria.
 */
export async function loginWith(
  agent: TestAgent,
  email: string,
  password: string,
  options: { secret?: string; enrollMfa?: boolean } = {},
): Promise<{ csrf: string; recoveryCodes?: string[] }> {
  const login = await agent.post(`${API_PREFIX}/auth/login`).send({ email, password });
  let csrf = agentFor.lastCsrf(agent);
  let recoveryCodes: string[] | undefined;

  if (login.body?.status === 'mfa_required') {
    if (!options.secret) throw new Error('conta exige TOTP: informe `secret` no loginWith');
    await agent
      .post(`${API_PREFIX}/auth/mfa/verify`)
      .set('x-csrf-token', csrf)
      .send({ totp: totpFor(options.secret, email).generate() })
      .expect(204);
    csrf = agentFor.lastCsrf(agent);
  }

  if (login.body?.status === 'mfa_enrollment_required') {
    if (!options.enrollMfa) throw new Error('conta precisa cadastrar MFA: use `enrollMfa: true`');
    const setup = await agent.post(`${API_PREFIX}/auth/mfa/setup`).set('x-csrf-token', csrf);
    const enabled = await agent
      .post(`${API_PREFIX}/auth/mfa/enable`)
      .set('x-csrf-token', csrf)
      .send({ totp: totpFor(setup.body.secret, email).generate() })
      .expect(200);
    recoveryCodes = enabled.body.recoveryCodes;
    csrf = agentFor.lastCsrf(agent);
  }

  return { csrf, recoveryCodes };
}

/** Aceita um convite pendente e já entra com a conta criada. */
export async function acceptInvite(
  app: INestApplication,
  email: string,
  name: string,
  password: string,
): Promise<{ agent: TestAgent }> {
  const link = await findMailLink(email, /\/convite\?token=[^\s]+/);
  if (!link) throw new Error(`nenhum convite no Mailpit para ${email}`);
  const token = decodeURIComponent(
    new URL(link, 'http://localhost:3000').searchParams.get('token')!,
  );

  const agent = agentFor(app);
  await agent.get(`${API_PREFIX}/invites/preview?token=${encodeURIComponent(token)}`).expect(200);
  await agent.post(`${API_PREFIX}/invites/accept`).send({ token, name, password }).expect(200);
  await agent.post(`${API_PREFIX}/auth/login`).send({ email, password }).expect(200);
  return { agent };
}

/**
 * Busca no Mailpit o último e-mail para o destinatário e extrai um link.
 * O envio é assíncrono em relação à resposta HTTP, então há uma pequena espera com repetição.
 */
export async function findMailLink(
  to: string,
  pattern: RegExp,
  attempts = 15,
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
    );
    if (response.ok) {
      const payload = (await response.json()) as { messages: Array<{ ID: string }> };
      const [message] = payload.messages ?? [];
      if (message) {
        const detail = (await (
          await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
        ).json()) as {
          Text: string;
        };
        const match = detail.Text.match(pattern);
        if (match) return match[0];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

/**
 * Zera os contadores de rate limit.
 *
 * Todos os cenários saem do mesmo IP (127.0.0.1) e estourariam o limite de 10 logins/min uns
 * dos outros — o que testaria a suíte, não o produto. O limite em si tem cenário próprio.
 */
export async function clearRateLimits(app: INestApplication): Promise<void> {
  const redis = app.get(RedisService);
  const keys = await redis.client.keys('rl:*');
  if (keys.length > 0) await redis.client.del(...keys);
}

/** Remove o que estes testes criaram. A auditoria é append-only e permanece, de propósito. */
export async function resetAuthState(prisma: PrismaService): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { endsWith: '@teste.local' } } });
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: 'teste-' } } });
}
