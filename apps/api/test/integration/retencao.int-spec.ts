import { API_PREFIX } from '@dashsgs/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../../src/app.module';
import { correlationMiddleware } from '../../src/common/correlation/correlation.middleware';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenantDatabase } from '../../src/common/tenant';
import { OffboardingService } from '../../src/modules/retencao/offboarding.service';
import { RetencaoService } from '../../src/modules/retencao/retencao.service';
import { agentFor, clearRateLimits, loginWith } from './helpers/auth.helpers';
import {
  cleanupTenantFixtures,
  createTenantFixture,
  makePlatformAdmin,
  type TenantFixture,
} from './helpers/tenant.helpers';

const SENHA = 'Cavalo-Bateria-Grampo-Correto-9';

const diasAtras = (dias: number) => new Date(Date.now() - dias * 86_400_000);
const anosAtras = (anos: number) => new Date(Date.now() - anos * 365 * 86_400_000);

/**
 * Retenção, offboarding e break-glass (Fase 9 — E6-04 e E9-03) contra Postgres de verdade.
 *
 * Três promessas que só valem se forem verificáveis: **o que venceu some**, **quem saiu some
 * inteiro** e **quem opera a plataforma não lê dado de cliente** — exceto por uma porta estreita,
 * aprovada por outra pessoa, com prazo e relatório.
 */
describe('retenção, offboarding e break-glass (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantDb: TenantDatabase;
  let retencao: RetencaoService;
  let offboarding: OffboardingService;
  let tenant: TenantFixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.use(correlationMiddleware);
    app.use(cookieParser());
    app.setGlobalPrefix(API_PREFIX, { exclude: ['healthz', 'readyz', 'metrics'] });
    await app.init();

    prisma = app.get(PrismaService);
    tenantDb = app.get(TenantDatabase);
    retencao = app.get(RetencaoService);
    offboarding = app.get(OffboardingService);

    await clearRateLimits(app);
    await cleanupTenantFixtures(prisma);

    tenant = await createTenantFixture(app, {
      password: SENHA,
      filiais: [1],
      users: [
        { chave: 'dono', role: 'owner' },
        { chave: 'operador', role: 'viewer' },
      ],
    });
  });

  afterAll(async () => {
    await cleanupTenantFixtures(prisma);
    await app.close();
  });

  describe('purga por retenção', () => {
    it('apaga o que passou do prazo e não toca no que está dentro dele', async () => {
      await tenantDb.run(tenant.id, async (tx) => {
        await tx.syncApiCallLog.createMany({
          data: [
            {
              tenantId: tenant.id,
              endpoint: '/vendas',
              method: 'GET',
              httpStatus: 200,
              durationMs: 10,
              calledAt: diasAtras(60),
            },
            {
              tenantId: tenant.id,
              endpoint: '/vendas',
              method: 'GET',
              httpStatus: 200,
              durationMs: 10,
              calledAt: diasAtras(2),
            },
          ],
        });
      });

      const purga = await retencao.purgar();
      const chamadas = purga.porPolitica.find((linha) => linha.politica === 'chamadas_sg');
      expect(chamadas?.removidos).toBeGreaterThanOrEqual(1);

      const restantes = await tenantDb.run(tenant.id, async (tx) =>
        tx.syncApiCallLog.findMany({ select: { calledAt: true } }),
      );
      expect(restantes).toHaveLength(1);
      expect(restantes[0]?.calledAt.getTime()).toBeGreaterThan(diasAtras(30).getTime());
    });

    it('depois da purga a verificação zera — é o critério de aceite do E6-04', async () => {
      await retencao.purgar();
      const pendencias = await retencao.verificar();

      const fora = pendencias.filter((linha) => linha.pendentes > 0);
      expect(fora).toEqual([]);
    });

    it('rodar de novo não remove nada: a purga é idempotente', async () => {
      await retencao.purgar();
      const segunda = await retencao.purgar();
      expect(segunda.removidos).toBe(0);
    });

    it('registra na trilha o que apagou, mesmo quando não apagou nada', async () => {
      await retencao.purgar();
      const registro = await prisma.auditLog.findFirst({
        where: { action: 'retencao.purge' },
        orderBy: { createdAt: 'desc' },
      });
      expect(registro).not.toBeNull();
    });
  });

  describe('auditoria: append-only com uma única exceção', () => {
    it('recusa DELETE de linha recente, mesmo pedido direto no banco', async () => {
      await prisma.auditLog.create({
        data: {
          action: 'teste.recente',
          resourceType: 'teste',
          result: 'success',
          tenantId: tenant.id,
        },
      });

      await expect(
        prisma.$executeRawUnsafe(`DELETE FROM app_audit_log WHERE action = 'teste.recente'`),
      ).rejects.toThrow();
    });

    it('a função de purga apaga o que já passou dos cinco anos', async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO app_audit_log (action, resource_type, result, created_at)
         VALUES ('teste.antigo', 'teste', 'success', $1::timestamptz)`,
        anosAtras(6).toISOString(),
      );

      const antes = await prisma.auditLog.count({ where: { action: 'teste.antigo' } });
      expect(antes).toBe(1);

      await retencao.purgar();

      const depois = await prisma.auditLog.count({ where: { action: 'teste.antigo' } });
      expect(depois).toBe(0);
    });

    it('a exceção não vale para linha nova, nem com o sinalizador ligado', async () => {
      await prisma.auditLog.create({
        data: { action: 'teste.protegido', resourceType: 'teste', result: 'success' },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.audit_purge', 'on', true)`);
          await tx.$executeRawUnsafe(`DELETE FROM app_audit_log WHERE action = 'teste.protegido'`);
        }),
      ).rejects.toThrow();
    });
  });

  describe('offboarding', () => {
    it('purga o tenant desligado por inteiro e deixa o comprovante', async () => {
      const saindo = await createTenantFixture(app, {
        password: SENHA,
        filiais: [1],
        users: [{ chave: 'dono', role: 'owner' }],
      });

      await tenantDb.run(saindo.id, async (tx) => {
        await tx.syncApiCallLog.create({
          data: {
            tenantId: saindo.id,
            endpoint: '/vendas',
            method: 'GET',
            httpStatus: 200,
            durationMs: 5,
          },
        });
      });

      // Desligado há 40 dias: passou da carência de 30 do doc 08 §5.
      await prisma.tenant.update({
        where: { id: saindo.id },
        data: { deletedAt: diasAtras(40), status: 'suspended' },
      });

      const purgados = await offboarding.purgarPendentes();
      expect(purgados.map((linha) => linha.tenantId)).toContain(saindo.id);

      // Espelho vazio, vínculos desfeitos.
      const filiais = await tenantDb.run(saindo.id, async (tx) => tx.erpFilial.count());
      expect(filiais).toBe(0);
      expect(await prisma.membership.count({ where: { tenantId: saindo.id } })).toBe(0);

      // Lápide: o tenant continua existindo para que a auditoria tenha a quem se referir.
      const lapide = await prisma.tenant.findUnique({ where: { id: saindo.id } });
      expect(lapide?.purgedAt).not.toBeNull();

      // Comprovante de destruição (LGPD art. 16).
      const comprovante = await prisma.auditLog.findFirst({
        where: { action: 'tenant.purged', tenantId: saindo.id },
      });
      expect(comprovante).not.toBeNull();
    });

    it('não purga quem ainda está na carência', async () => {
      const recente = await createTenantFixture(app, {
        password: SENHA,
        filiais: [1],
        users: [{ chave: 'dono', role: 'owner' }],
      });
      await prisma.tenant.update({
        where: { id: recente.id },
        data: { deletedAt: diasAtras(3) },
      });

      const pendentes = await offboarding.pendentes();
      expect(pendentes.map((linha) => linha.id)).not.toContain(recente.id);
    });

    it('recusa purgar tenant ativo — não existe atalho', async () => {
      await expect(offboarding.purgarTenant(tenant.id)).rejects.toThrow(/excluído logicamente/);
    });
  });

  describe('break-glass', () => {
    let operador: TestAgent;
    let aprovador: TestAgent;
    let csrfOperador: string;
    let csrfAprovador: string;
    let operadorId: string;
    let grantId: string;

    beforeAll(async () => {
      const plataforma = await createTenantFixture(app, {
        password: SENHA,
        filiais: [1],
        users: [
          { chave: 'opsum', role: 'viewer' },
          { chave: 'opdois', role: 'viewer' },
        ],
      });

      operadorId = plataforma.users.opsum!.id;
      await makePlatformAdmin(app, operadorId);
      await makePlatformAdmin(app, plataforma.users.opdois!.id);

      // Conta de operação não tem vínculo com tenant algum (doc 07 §2). Sem isso o cenário
      // testaria outra coisa: um usuário comum que por acaso administra a plataforma.
      await prisma.membership.deleteMany({
        where: { userId: { in: [operadorId, plataforma.users.opdois!.id] } },
      });

      // Operar a plataforma exige MFA recente (doc 07 §2) — as contas cadastram na hora.
      operador = agentFor(app);
      const um = await loginWith(operador, plataforma.users.opsum!.email, SENHA, {
        enrollMfa: true,
      });
      csrfOperador = um.csrf;

      aprovador = agentFor(app);
      const dois = await loginWith(aprovador, plataforma.users.opdois!.email, SENHA, {
        enrollMfa: true,
      });
      csrfAprovador = dois.csrf;
    });

    it('sem concessão, quem opera a plataforma não enxerga dado de tenant', async () => {
      const resposta = await operador.get(`${API_PREFIX}/dashboard/home`);
      expect([400, 403, 404, 422]).toContain(resposta.status);
    });

    it('o pedido nasce pendente e não abre nada sozinho', async () => {
      const pedido = await operador
        .post(`${API_PREFIX}/platform/break-glass`)
        .set('x-csrf-token', csrfOperador)
        .send({
          tenantId: tenant.id,
          ticket: 'SUP-4521',
          justificativa: 'Cliente relata aging divergente; investigar parcelas duplicadas.',
          papel: 'manager',
          minutos: 60,
        })
        .expect(201);

      grantId = pedido.body.id;
      expect(pedido.body.status).toBe('aguardando_aprovacao');

      const resposta = await operador.get(`${API_PREFIX}/dashboard/home`);
      expect([400, 403, 404, 422]).toContain(resposta.status);
    });

    it('quem pede não aprova', async () => {
      await operador
        .post(`${API_PREFIX}/platform/break-glass/${grantId}/aprovar`)
        .set('x-csrf-token', csrfOperador)
        .expect(403);
    });

    it('aprovado por outra pessoa, o acesso abre — e o owner é avisado', async () => {
      const aprovacao = await aprovador
        .post(`${API_PREFIX}/platform/break-glass/${grantId}/aprovar`)
        .set('x-csrf-token', csrfAprovador)
        .expect(200);

      expect(aprovacao.body.status).toBe('ativa');
      expect(aprovacao.body.aprovador.id).not.toBe(operadorId);

      const trilha = await prisma.auditLog.findFirst({
        where: { action: 'breakglass.approved', tenantId: tenant.id },
      });
      expect(trilha).not.toBeNull();

      const home = await operador.get(`${API_PREFIX}/dashboard/home`).expect(200);
      expect(home.body).toBeDefined();
    });

    it('cada requisição sob a concessão vira linha do relatório', async () => {
      await operador.get(`${API_PREFIX}/dashboard/home`).expect(200);

      const relatorio = await aprovador
        .get(`${API_PREFIX}/platform/break-glass/${grantId}/relatorio`)
        .expect(200);

      expect(relatorio.body.concessao.acessos).toBeGreaterThan(0);
      expect(relatorio.body.acessos.length).toBeGreaterThan(0);
      expect(relatorio.body.acessos[0].rota).toContain('/dashboard');
    });

    it('revogada, a porta fecha na requisição seguinte', async () => {
      await aprovador
        .post(`${API_PREFIX}/platform/break-glass/${grantId}/revogar`)
        .set('x-csrf-token', csrfAprovador)
        .expect(200);

      const resposta = await operador.get(`${API_PREFIX}/dashboard/home`);
      expect([400, 403, 404, 422]).toContain(resposta.status);
    });

    it('concessão expirada não abre nada', async () => {
      const expirada = await prisma.breakGlassGrant.create({
        data: {
          tenantId: tenant.id,
          requestedBy: operadorId,
          approvedBy: operadorId,
          ticket: 'SUP-0001',
          justification: 'Concessão vencida usada como armadilha de teste.',
          role: 'manager',
          ttlMinutes: 60,
          approvedAt: diasAtras(1),
          expiresAt: diasAtras(1),
        },
      });

      const resposta = await operador.get(`${API_PREFIX}/dashboard/home`);
      expect([400, 403, 404, 422]).toContain(resposta.status);

      await prisma.breakGlassGrant.delete({ where: { id: expirada.id } });
    });
  });
});
