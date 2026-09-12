import { API_PREFIX } from '@dashsgs/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AuditService } from '../../src/common/audit';
import { correlationMiddleware } from '../../src/common/correlation/correlation.middleware';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  acceptInvite,
  agentFor,
  clearRateLimits,
  createTenantWithOwner,
  findMailLink,
  loginWith,
  resetAuthState,
  totpFor,
  uniqueEmail,
} from './helpers/auth.helpers';

/**
 * Testes de integração da autenticação (doc 17 §2 "AuthN/AuthZ").
 * Exige Postgres, Redis e Mailpit reais — o compose de dev ou os services do CI.
 */
describe('autenticação (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditService;
  const PASSWORD = 'Cavalo-Bateria-Grampo-Correto-9';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.use(correlationMiddleware);
    app.use(cookieParser());
    app.setGlobalPrefix(API_PREFIX, { exclude: ['healthz', 'readyz', 'metrics'] });
    await app.init();

    prisma = app.get(PrismaService);
    audit = app.get(AuditService);
  });

  beforeEach(async () => {
    await clearRateLimits(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('login', () => {
    it('autentica com credenciais válidas e emite cookies HttpOnly', async () => {
      const { user } = await createTenantWithOwner(app, { role: 'analyst', password: PASSWORD });
      const agent = agentFor(app);

      const response = await agent
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);

      expect(response.body).toEqual({ status: 'authenticated' });
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((cookie) => /dashsgs_session=.*HttpOnly/i.test(cookie))).toBe(true);
      expect(cookies.some((cookie) => /dashsgs_csrf=.*HttpOnly/i.test(cookie))).toBe(true);
      expect(cookies.every((cookie) => /SameSite=Lax/i.test(cookie))).toBe(true);
    });

    it('responde igual para senha errada e conta inexistente (sem enumeração)', async () => {
      const { user } = await createTenantWithOwner(app, { role: 'viewer', password: PASSWORD });
      const agent = agentFor(app);

      const wrongPassword = await agent
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: user.email, password: 'senha-errada-porem-longa' })
        .expect(401);
      const unknownUser = await agent
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: uniqueEmail('fantasma'), password: 'senha-errada-porem-longa' })
        .expect(401);

      expect(wrongPassword.body.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(unknownUser.body.code).toBe(wrongPassword.body.code);
      expect(unknownUser.body.message).toBe(wrongPassword.body.message);
    });

    it('bloqueia a conta após tentativas repetidas (lockout incremental)', async () => {
      const { user } = await createTenantWithOwner(app, { role: 'viewer', password: PASSWORD });
      const agent = agentFor(app);

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await agent
          .post(`${API_PREFIX}/auth/login`)
          .send({ email: user.email, password: 'senha-errada-porem-longa' });
        statuses.push(response.status);
      }

      // Rate limit por conta (429) ou lockout (423): os dois são recusa — o que não pode é 200.
      expect(statuses.every((status) => status === 401 || status === 423 || status === 429)).toBe(
        true,
      );
      expect(statuses.at(-1)).not.toBe(200);

      const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(locked.failedAttempts).toBeGreaterThanOrEqual(5);
      expect(locked.lockedUntil?.getTime() ?? 0).toBeGreaterThan(Date.now());

      // Mesmo com a senha certa, conta bloqueada não entra.
      const afterLock = await agent
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: user.email, password: PASSWORD });
      expect([423, 429]).toContain(afterLock.status);
    });

    it('rejeita payload com campo não declarado (whitelist)', async () => {
      const agent = agentFor(app);
      const response = await agent
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: uniqueEmail('x'), password: PASSWORD, isAdmin: true })
        .expect(422);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('sessão', () => {
    it('/me exige sessão e devolve permissões do papel', async () => {
      const { user, tenant } = await createTenantWithOwner(app, {
        role: 'manager',
        password: PASSWORD,
      });
      const agent = agentFor(app);
      await loginWith(agent, user.email, PASSWORD);

      const anonymous = await request(app.getHttpServer()).get(`${API_PREFIX}/me`).expect(401);
      expect(anonymous.body.code).toBe('AUTH_REQUIRED');

      const me = await agent.get(`${API_PREFIX}/me`).expect(200);
      expect(me.body.user.email).toBe(user.email);
      expect(me.body.activeTenantId).toBe(tenant.id);
      expect(me.body.permissions).toEqual(
        expect.arrayContaining(['dashboard.view', 'alerts.manage', 'erp.propose']),
      );
      expect(me.body.permissions).not.toContain('users.manage');
    });

    it('logout revoga a sessão no servidor', async () => {
      const { user } = await createTenantWithOwner(app, { role: 'viewer', password: PASSWORD });
      const agent = agentFor(app);
      const { csrf } = await loginWith(agent, user.email, PASSWORD);

      await agent.post(`${API_PREFIX}/auth/logout`).set('x-csrf-token', csrf).expect(204);
      await agent.get(`${API_PREFIX}/me`).expect(401);
    });

    it('lista e revoga sessões ativas', async () => {
      const { user } = await createTenantWithOwner(app, { role: 'viewer', password: PASSWORD });
      const first = agentFor(app);
      const second = agentFor(app);
      const { csrf } = await loginWith(first, user.email, PASSWORD);
      await loginWith(second, user.email, PASSWORD);

      const list = await first.get(`${API_PREFIX}/auth/sessions`).expect(200);
      expect(list.body).toHaveLength(2);
      expect(list.body.filter((item: { current: boolean }) => item.current)).toHaveLength(1);

      const other = list.body.find((item: { current: boolean }) => !item.current);
      await first
        .delete(`${API_PREFIX}/auth/sessions/${other.id}`)
        .set('x-csrf-token', csrf)
        .expect(204);

      await second.get(`${API_PREFIX}/me`).expect(401);
      await first.get(`${API_PREFIX}/me`).expect(200);
    });

    it('não permite revogar sessão de outra pessoa (404 uniforme)', async () => {
      const alice = await createTenantWithOwner(app, { role: 'viewer', password: PASSWORD });
      const bob = await createTenantWithOwner(app, { role: 'viewer', password: PASSWORD });
      const alicesAgent = agentFor(app);
      const bobsAgent = agentFor(app);
      const { csrf } = await loginWith(alicesAgent, alice.user.email, PASSWORD);
      await loginWith(bobsAgent, bob.user.email, PASSWORD);

      const bobsSessions = await bobsAgent.get(`${API_PREFIX}/auth/sessions`).expect(200);
      const response = await alicesAgent
        .delete(`${API_PREFIX}/auth/sessions/${bobsSessions.body[0].id}`)
        .set('x-csrf-token', csrf)
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
      await bobsAgent.get(`${API_PREFIX}/me`).expect(200);
    });
  });

  describe('CSRF', () => {
    it('recusa mutação autenticada sem o token e aceita com ele', async () => {
      const { user } = await createTenantWithOwner(app, { role: 'owner', password: PASSWORD });
      const agent = agentFor(app);
      const { csrf } = await loginWith(agent, user.email, PASSWORD, { enrollMfa: true });

      const semToken = await agent.post(`${API_PREFIX}/auth/logout`).expect(403);
      expect(semToken.body.code).toBe('FORBIDDEN');

      const tokenErrado = await agent
        .post(`${API_PREFIX}/auth/logout`)
        .set('x-csrf-token', 'token-de-outra-sessao')
        .expect(403);
      expect(tokenErrado.body.code).toBe('FORBIDDEN');

      await agent.post(`${API_PREFIX}/auth/logout`).set('x-csrf-token', csrf).expect(204);
    });
  });

  describe('MFA', () => {
    it('owner só obtém sessão completa depois de cadastrar e provar o TOTP', async () => {
      const { user } = await createTenantWithOwner(app, { role: 'owner', password: PASSWORD });
      const agent = agentFor(app);

      const login = await agent
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      expect(login.body.status).toBe('mfa_enrollment_required');

      const csrf = agentFor.lastCsrf(agent);
      await agent.get(`${API_PREFIX}/me`).expect(401);
      await agent.get(`${API_PREFIX}/me/pending`).expect(200);

      const setup = await agent
        .post(`${API_PREFIX}/auth/mfa/setup`)
        .set('x-csrf-token', csrf)
        .expect(200);
      expect(setup.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

      const totp = totpFor(setup.body.secret, user.email);
      await agent
        .post(`${API_PREFIX}/auth/mfa/enable`)
        .set('x-csrf-token', csrf)
        .send({ totp: '000000' })
        .expect(422);

      const enabled = await agent
        .post(`${API_PREFIX}/auth/mfa/enable`)
        .set('x-csrf-token', csrf)
        .send({ totp: totp.generate() })
        .expect(200);
      expect(enabled.body.recoveryCodes).toHaveLength(10);

      const me = await agent.get(`${API_PREFIX}/me`).expect(200);
      expect(me.body.mfa).toMatchObject({ required: true, enabled: true, verifiedRecently: true });
    });

    it('rotaciona o id da sessão ao concluir o segundo fator (anti-fixation)', async () => {
      const { user, secret } = await createTenantWithOwner(app, {
        role: 'owner',
        password: PASSWORD,
        withMfa: true,
      });
      const agent = agentFor(app);

      await agent
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      const partialSession = agentFor.lastSession(agent);

      await agent
        .post(`${API_PREFIX}/auth/mfa/verify`)
        .set('x-csrf-token', agentFor.lastCsrf(agent))
        .send({ totp: totpFor(secret!, user.email).generate() })
        .expect(204);

      expect(agentFor.lastSession(agent)).not.toBe(partialSession);
      await agent.get(`${API_PREFIX}/me`).expect(200);
    });

    it('aceita código de recuperação uma única vez', async () => {
      const { user, recoveryCodes } = await createTenantWithOwner(app, {
        role: 'owner',
        password: PASSWORD,
        withMfa: true,
      });
      const code = recoveryCodes![0] as string;

      const first = agentFor(app);
      await first.post(`${API_PREFIX}/auth/login`).send({ email: user.email, password: PASSWORD });
      await first
        .post(`${API_PREFIX}/auth/mfa/verify`)
        .set('x-csrf-token', agentFor.lastCsrf(first))
        .send({ recoveryCode: code })
        .expect(204);

      const second = agentFor(app);
      await second.post(`${API_PREFIX}/auth/login`).send({ email: user.email, password: PASSWORD });
      await second
        .post(`${API_PREFIX}/auth/mfa/verify`)
        .set('x-csrf-token', agentFor.lastCsrf(second))
        .send({ recoveryCode: code })
        .expect(401);
    });

    it('não deixa owner desativar o MFA que o papel exige', async () => {
      const { user, secret } = await createTenantWithOwner(app, {
        role: 'owner',
        password: PASSWORD,
        withMfa: true,
      });
      const agent = agentFor(app);
      const { csrf } = await loginWith(agent, user.email, PASSWORD, { secret });

      const response = await agent
        .post(`${API_PREFIX}/auth/mfa/disable`)
        .set('x-csrf-token', csrf)
        .send({ password: PASSWORD, totp: totpFor(secret!, user.email).generate() })
        .expect(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('senha', () => {
    it('recupera por e-mail, invalida sessões e o token vale uma vez só', async () => {
      const { user } = await createTenantWithOwner(app, { role: 'viewer', password: PASSWORD });
      const logged = agentFor(app);
      await loginWith(logged, user.email, PASSWORD);

      const anonymous = agentFor(app);
      await anonymous
        .post(`${API_PREFIX}/auth/password/forgot`)
        .send({ email: user.email })
        .expect(202);
      await anonymous
        .post(`${API_PREFIX}/auth/password/forgot`)
        .send({ email: uniqueEmail('nao-existe') })
        .expect(202);

      const link = await findMailLink(user.email, /\/redefinir-senha\?token=[^\s]+/);
      expect(link).toBeTruthy();
      const token = decodeURIComponent(
        new URL(link!, 'http://localhost:3000').searchParams.get('token')!,
      );

      const novaSenha = 'Trombone-Azul-Quarenta-Sete';
      await anonymous
        .post(`${API_PREFIX}/auth/password/reset`)
        .send({ token, password: novaSenha })
        .expect(204);

      await logged.get(`${API_PREFIX}/me`).expect(401);
      await anonymous
        .post(`${API_PREFIX}/auth/password/reset`)
        .send({ token, password: 'Outra-Coisa-Bem-Longa-2026' })
        .expect(422);

      const relogin = agentFor(app);
      await relogin
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: user.email, password: novaSenha })
        .expect(200);
    });

    it('recusa senha fraca na redefinição', async () => {
      const { user } = await createTenantWithOwner(app, { role: 'viewer', password: PASSWORD });
      const anonymous = agentFor(app);
      await anonymous
        .post(`${API_PREFIX}/auth/password/forgot`)
        .send({ email: user.email })
        .expect(202);

      const link = await findMailLink(user.email, /\/redefinir-senha\?token=[^\s]+/);
      const token = decodeURIComponent(
        new URL(link!, 'http://localhost:3000').searchParams.get('token')!,
      );

      const response = await anonymous
        .post(`${API_PREFIX}/auth/password/reset`)
        .send({ token, password: 'senha12345678' })
        .expect(422);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('troca de senha exige a atual e derruba as outras sessões', async () => {
      const { user } = await createTenantWithOwner(app, { role: 'viewer', password: PASSWORD });
      const primary = agentFor(app);
      const secondary = agentFor(app);
      const { csrf } = await loginWith(primary, user.email, PASSWORD);
      await loginWith(secondary, user.email, PASSWORD);

      await primary
        .post(`${API_PREFIX}/auth/password/change`)
        .set('x-csrf-token', csrf)
        .send({ currentPassword: 'errada-mas-longa', newPassword: 'Jabuticaba-Roxa-Setenta-2' })
        .expect(401);

      await primary
        .post(`${API_PREFIX}/auth/password/change`)
        .set('x-csrf-token', csrf)
        .send({ currentPassword: PASSWORD, newPassword: 'Jabuticaba-Roxa-Setenta-2' })
        .expect(204);

      await primary.get(`${API_PREFIX}/me`).expect(200);
      await secondary.get(`${API_PREFIX}/me`).expect(401);
    });
  });

  describe('convites', () => {
    it('convida, aceita e cria o vínculo com o papel do convite', async () => {
      const { user, tenant, secret } = await createTenantWithOwner(app, {
        role: 'owner',
        password: PASSWORD,
        withMfa: true,
      });
      const agent = agentFor(app);
      const { csrf } = await loginWith(agent, user.email, PASSWORD, { secret });

      const convidado = uniqueEmail('convidado');
      await agent
        .post(`${API_PREFIX}/tenant/invites`)
        .set('x-csrf-token', csrf)
        .send({ email: convidado, role: 'analyst' })
        .expect(201);

      const pendentes = await agent.get(`${API_PREFIX}/tenant/invites`).expect(200);
      expect(pendentes.body).toHaveLength(1);

      const { agent: guest } = await acceptInvite(app, convidado, 'Convidado Teste', PASSWORD);
      const me = await guest.get(`${API_PREFIX}/me`).expect(200);
      expect(me.body.memberships[0]).toMatchObject({ tenantId: tenant.id, role: 'analyst' });
    });

    it('viewer não pode convidar (403 + evento authz.denied)', async () => {
      const { user } = await createTenantWithOwner(app, { role: 'viewer', password: PASSWORD });
      const agent = agentFor(app);
      const { csrf } = await loginWith(agent, user.email, PASSWORD);

      const before = await prisma.auditLog.count({ where: { action: 'authz.denied' } });
      const response = await agent
        .post(`${API_PREFIX}/tenant/invites`)
        .set('x-csrf-token', csrf)
        .send({ email: uniqueEmail('alvo'), role: 'viewer' })
        .expect(403);
      const after = await prisma.auditLog.count({ where: { action: 'authz.denied' } });

      expect(response.body.code).toBe('FORBIDDEN');
      expect(after).toBe(before + 1);
    });

    it('admin não consegue convidar owner (escalada de privilégio)', async () => {
      const { user, secret } = await createTenantWithOwner(app, {
        role: 'admin',
        password: PASSWORD,
        withMfa: true,
      });
      const agent = agentFor(app);
      const { csrf } = await loginWith(agent, user.email, PASSWORD, { secret });

      await agent
        .post(`${API_PREFIX}/tenant/invites`)
        .set('x-csrf-token', csrf)
        .send({ email: uniqueEmail('novo-dono'), role: 'owner' })
        .expect(403);
    });

    it('token de convite inválido não revela nada', async () => {
      const response = await request(app.getHttpServer())
        .get(`${API_PREFIX}/invites/preview?token=${'x'.repeat(43)}`)
        .expect(422);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(response.body)).not.toContain('tenant');
    });
  });

  describe('auditoria', () => {
    it('registra os eventos de autenticação com cadeia de hash íntegra', async () => {
      const marco = await prisma.auditLog.findFirst({
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      const { user } = await createTenantWithOwner(app, { role: 'viewer', password: PASSWORD });
      const agent = agentFor(app);
      const { csrf } = await loginWith(agent, user.email, PASSWORD);
      await agent.post(`${API_PREFIX}/auth/logout`).set('x-csrf-token', csrf).expect(204);

      const eventos = await prisma.auditLog.findMany({
        where: { userId: user.id },
        orderBy: { id: 'asc' },
        select: { action: true, result: true, entryHash: true, prevHash: true, changes: true },
      });

      expect(eventos.map((evento) => evento.action)).toEqual(
        expect.arrayContaining(['auth.login.succeeded', 'auth.logout']),
      );
      expect(eventos.every((evento) => evento.entryHash !== null)).toBe(true);

      // Janela do cenário: a cadeia é conferida do marco em diante.
      const verification = await audit.verifyChain({ fromId: (marco?.id ?? 0n) + 1n });
      expect(verification.ok).toBe(true);
    });

    it('não guarda segredo nem PII crua no campo de mudanças', async () => {
      const { user, secret } = await createTenantWithOwner(app, {
        role: 'owner',
        password: PASSWORD,
        withMfa: true,
      });
      const agent = agentFor(app);
      const { csrf } = await loginWith(agent, user.email, PASSWORD, { secret });

      const convidado = uniqueEmail('auditado');
      await agent
        .post(`${API_PREFIX}/tenant/invites`)
        .set('x-csrf-token', csrf)
        .send({ email: convidado, role: 'viewer' });

      const evento = await prisma.auditLog.findFirst({
        where: { action: 'user.invited' },
        orderBy: { id: 'desc' },
      });
      const serialized = JSON.stringify(evento?.changes ?? {});
      expect(serialized).not.toContain(convidado);
      expect(serialized).toContain('REDACTED');
      expect(serialized).toContain('viewer');
    });

    it('a trilha é append-only no banco (UPDATE e DELETE barrados)', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE app_audit_log SET action = 'adulterado' WHERE id = (SELECT max(id) FROM app_audit_log)`,
        ),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM app_audit_log WHERE id = (SELECT max(id) FROM app_audit_log)`,
        ),
      ).rejects.toThrow();
    });
  });

  afterAll(async () => {
    await resetAuthState(prisma);
  });
});
