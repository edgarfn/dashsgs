import { API_PREFIX, type AuditEntryView, type Paginated } from '@dashsgs/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../../src/app.module';
import { AuditService } from '../../src/common/audit';
import { correlationMiddleware } from '../../src/common/correlation/correlation.middleware';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { agentFor, clearRateLimits, loginWith } from './helpers/auth.helpers';
import {
  cleanupTenantFixtures,
  createTenantFixture,
  type TenantFixture,
  hojeNoTenant,
} from './helpers/tenant.helpers';

const SENHA = 'Cavalo-Bateria-Grampo-Correto-9';

/**
 * Trilha de auditoria pela API (E6-01, doc 16 §2).
 *
 * O cenário que mais importa aqui não é o filtro: é o **recorte**. A tabela usa RLS de
 * identidade, que aceita `tenant_id IS NULL` — e precisa aceitar, porque login acontece antes de
 * existir tenant. Um serviço que confiasse só nela mostraria ao administrador de uma rede as
 * tentativas de login de todas as outras.
 */
describe('auditoria (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditService;

  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let donoA: TestAgent;
  let auditorA: TestAgent;
  let viewerA: TestAgent;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.use(correlationMiddleware);
    app.use(cookieParser());
    app.setGlobalPrefix(API_PREFIX, { exclude: ['healthz', 'readyz', 'metrics'] });
    await app.init();

    prisma = app.get(PrismaService);
    audit = app.get(AuditService);

    await clearRateLimits(app);

    tenantA = await createTenantFixture(app, {
      password: SENHA,
      filiais: [],
      users: [
        { chave: 'dono', role: 'owner' },
        { chave: 'auditor', role: 'auditor' },
        { chave: 'viewer', role: 'viewer' },
      ],
    });

    tenantB = await createTenantFixture(app, {
      password: SENHA,
      filiais: [],
      users: [{ chave: 'dono', role: 'owner' }],
    });

    donoA = agentFor(app);
    await loginWith(donoA, tenantA.users.dono!.email, SENHA, { enrollMfa: true });

    auditorA = agentFor(app);
    await loginWith(auditorA, tenantA.users.auditor!.email, SENHA);

    viewerA = agentFor(app);
    await loginWith(viewerA, tenantA.users.viewer!.email, SENHA);
  });

  beforeEach(async () => {
    await clearRateLimits(app);
  });

  afterAll(async () => {
    await cleanupTenantFixtures(prisma);
    await app?.close();
  });

  const buscar = async (agente: TestAgent, query = '') => {
    const resposta = await agente.get(`${API_PREFIX}/tenant/audit${query}`).expect(200);
    return resposta.body as Paginated<AuditEntryView>;
  };

  // ------------------------------------------------------------------ permissão
  describe('quem enxerga a trilha', () => {
    it('o papel auditor lê, mesmo sem administrar nada', async () => {
      const trilha = await buscar(auditorA);
      expect(trilha.data.length).toBeGreaterThan(0);
    });

    it('viewer não lê — audit.view é permissão à parte', async () => {
      await viewerA.get(`${API_PREFIX}/tenant/audit`).expect(403);
    });
  });

  // ------------------------------------------------------------------ recorte
  describe('recorte por tenant', () => {
    it('não mostra evento de outra rede', async () => {
      await audit.record({
        action: 'tenant.member_updated',
        resourceType: 'membership',
        result: 'success',
        tenantId: tenantB.id,
        userId: tenantB.users.dono!.id,
      });

      const trilha = await buscar(donoA, '?pageSize=200');
      const doVizinho = trilha.data.filter(
        (evento) => evento.ator?.email === tenantB.users.dono!.email,
      );

      expect(doVizinho).toEqual([]);
    });

    /**
     * Este é o cenário que a RLS sozinha deixaria passar: evento sem tenant, de gente que não é
     * desta rede. É exatamente a forma dos eventos de login.
     */
    it('não mostra evento sem tenant de quem não é membro', async () => {
      await audit.record({
        action: 'auth.login.succeeded',
        resourceType: 'session',
        result: 'success',
        userId: tenantB.users.dono!.id,
      });

      const trilha = await buscar(donoA, '?pageSize=200&acao=auth.login.succeeded');
      const estranhos = trilha.data.filter(
        (evento) => evento.ator?.email === tenantB.users.dono!.email,
      );

      expect(estranhos).toEqual([]);
    });

    it('mostra o login do próprio membro, que é gravado sem tenant', async () => {
      const trilha = await buscar(donoA, '?pageSize=200&acao=auth.login.succeeded');
      // O auditor entrou com login simples (o owner para no cadastro de MFA e não chega a
      // `succeeded`): é o evento dele que prova a segunda metade do recorte.
      const proprios = trilha.data.filter(
        (evento) => evento.ator?.email === tenantA.users.auditor!.email,
      );

      // Sem essa metade a tela não mostraria login nenhum — e login é o primeiro evento que
      // qualquer auditoria procura.
      expect(proprios.length).toBeGreaterThan(0);
    });

    it('não mostra tentativa de login de e-mail que não existe', async () => {
      await audit.record({
        action: 'auth.login.failed',
        resourceType: 'session',
        result: 'denied',
        changes: { reason: 'usuario_inexistente' },
      });

      const trilha = await buscar(donoA, '?pageSize=200&acao=auth.login.failed');
      const semAtorNemTenant = trilha.data.filter(
        (evento) =>
          evento.ator === null &&
          (evento.changes as { reason?: string } | null)?.reason === 'usuario_inexistente',
      );

      // É evento de plataforma: contar a um cliente que alguém tentou entrar noutra conta seria
      // vazamento — mesmo sem dizer qual conta.
      expect(semAtorNemTenant).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ filtros
  describe('filtros', () => {
    it('traduz a ação para português e marca o que é sensível', async () => {
      const trilha = await buscar(donoA, '?acao=auth.login.succeeded&pageSize=10');
      const evento = trilha.data[0]!;

      expect(evento.acaoLabel).toBe('Entrou no sistema');
      expect(evento.categoria).toBe('acesso');
      expect(evento.sensivel).toBe(false);
    });

    it('filtra por categoria, e não só por ação exata', async () => {
      const trilha = await buscar(donoA, '?categoria=acesso&pageSize=200');

      expect(trilha.data.length).toBeGreaterThan(0);
      expect(trilha.data.every((evento) => evento.categoria === 'acesso')).toBe(true);
    });

    it('o período inclui o dia final inteiro', async () => {
      const hoje = hojeNoTenant();
      const trilha = await buscar(donoA, `?de=${hoje}&ate=${hoje}&pageSize=200`);

      // Tudo do fixture foi gravado hoje: um `ate` exclusivo devolveria zero e ninguém
      // entenderia por quê.
      expect(trilha.data.length).toBeGreaterThan(0);
    });

    it('lista só as ações que existem nesta rede', async () => {
      const resposta = await donoA.get(`${API_PREFIX}/tenant/audit/acoes`).expect(200);
      const acoes = resposta.body as string[];

      expect(acoes).toContain('auth.login.succeeded');
      expect(acoes.length).toBeLessThan(40);
    });

    it('recusa filtro desconhecido em vez de ampliar a consulta em silêncio', async () => {
      await donoA.get(`${API_PREFIX}/tenant/audit?inventado=1`).expect(422);
      await donoA.get(`${API_PREFIX}/tenant/audit?de=2026-13-01`).expect(422);
      await donoA.get(`${API_PREFIX}/tenant/audit?de=2026-09-10&ate=2026-09-01`).expect(422);
    });
  });

  // ------------------------------------------------------------------ export
  describe('export', () => {
    it('devolve CSV e registra o próprio export na trilha', async () => {
      const resposta = await donoA.get(`${API_PREFIX}/tenant/audit/export`).expect(200);

      expect(resposta.headers['content-type']).toContain('text/csv');
      expect(resposta.text).toContain('Ação');
      expect(resposta.headers['content-disposition']).toContain('auditoria');

      const depois = await buscar(donoA, '?acao=audit.exported&pageSize=10');
      expect(depois.data.length).toBeGreaterThan(0);
      expect(depois.data[0]!.acaoLabel).toBe('Trilha de auditoria exportada');
      // O export é sensível: é o momento em que a trilha sai do nosso controle (doc 10 §3).
      expect(depois.data[0]!.sensivel).toBe(true);
    });
  });

  // ------------------------------------------------------------------ integridade
  describe('verificação da cadeia (plataforma)', () => {
    it('não é rota de tenant — o dono da rede recebe 404', async () => {
      // 404 e não 403: a área de plataforma não admite que existe para quem não é dela.
      await donoA.get(`${API_PREFIX}/platform/auditoria/verificacao`).expect(404);
    });

    /**
     * A janela é criada aqui de propósito. Verificar "as N mais antigas" do banco de
     * desenvolvimento daria falso vermelho: a suíte de retenção insere linhas cruas (é a única
     * forma de ter linha vencida para purgar), e linha que não passou pelo serviço não tem hash
     * — que é exatamente o que a verificação existe para acusar.
     */
    it('confere a cadeia de uma janela recém-escrita', async () => {
      const antes = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' } });
      const inicio = (antes?.id ?? BigInt(0)) + BigInt(1);

      for (const acao of ['sync.resync_requested', 'alert.acknowledged', 'auth.logout']) {
        await audit.recordOrThrow({
          action: acao,
          resourceType: 'teste',
          result: 'success',
          tenantId: tenantA.id,
          userId: tenantA.users.dono!.id,
        });
      }

      const resultado = await audit.verifyChain({ fromId: inicio, limit: 100 });

      expect(resultado.ok).toBe(true);
      expect(resultado.checked).toBeGreaterThanOrEqual(3);
      expect(resultado.brokenAtId).toBeUndefined();
    });

    it('acusa a linha que entrou por fora do serviço', async () => {
      const antes = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' } });
      const inicio = (antes?.id ?? BigInt(0)) + BigInt(1);

      await audit.recordOrThrow({
        action: 'auth.logout',
        resourceType: 'teste',
        result: 'success',
        tenantId: tenantA.id,
        userId: tenantA.users.dono!.id,
      });

      // Linha sem hash, inserida como um atacante com acesso ao banco faria.
      await prisma.$executeRaw`
        INSERT INTO app_audit_log (action, resource_type, result, tenant_id, created_at)
        VALUES ('auth.logout', 'teste', 'success', ${tenantA.id}::uuid, now())`;

      const resultado = await audit.verifyChain({ fromId: inicio, limit: 100 });

      expect(resultado.ok).toBe(false);
      expect(resultado.brokenAtId).toBeDefined();
    });
  });
});
