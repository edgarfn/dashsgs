import { API_PREFIX, tenantCacheKey } from '@dashsgs/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../../src/app.module';
import { correlationMiddleware } from '../../src/common/correlation/correlation.middleware';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { RedisService } from '../../src/common/redis/redis.service';
import { TenantDatabase } from '../../src/common/tenant';
import { agentFor, clearRateLimits, loginWith } from './helpers/auth.helpers';
import { listarRotas, preencherParams, type RotaRegistrada } from './helpers/router.helpers';
import {
  cleanupTenantFixtures,
  contemMarcaDe,
  createTenantFixture,
  type TenantFixture,
} from './helpers/tenant.helpers';

const SENHA = 'Cavalo-Bateria-Grampo-Correto-9';

/**
 * Isolamento multi-tenant (doc 08 §6) — o gate absoluto do produto.
 *
 * São quatro camadas, testadas separadamente porque falham separadamente: a RLS no banco, o
 * recorte por filial, a API vista do tenant vizinho e o cache. Nenhuma delas sozinha é suficiente.
 */
describe('isolamento multi-tenant (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantDb: TenantDatabase;
  let redis: RedisService;

  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let donoA: TestAgent;
  let csrfDonoA: string;
  let analistaA: TestAgent;
  let conviteB: { id: string };
  let alertaB: { id: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.use(correlationMiddleware);
    app.use(cookieParser());
    app.setGlobalPrefix(API_PREFIX, { exclude: ['healthz', 'readyz', 'metrics'] });
    await app.init();

    prisma = app.get(PrismaService);
    tenantDb = app.get(TenantDatabase);
    redis = app.get(RedisService);

    await clearRateLimits(app);

    tenantA = await createTenantFixture(app, {
      password: SENHA,
      filiais: [1, 2, 3],
      users: [
        { chave: 'dono', role: 'owner' },
        { chave: 'analista', role: 'analyst', filiaisAllowed: [1] },
      ],
    });
    tenantB = await createTenantFixture(app, {
      password: SENHA,
      filiais: [1, 2, 3, 4],
      users: [{ chave: 'dono', role: 'owner' }],
    });

    donoA = agentFor(app);
    const sessaoA = await loginWith(donoA, tenantA.users.dono!.email, SENHA, { enrollMfa: true });
    csrfDonoA = sessaoA.csrf;

    analistaA = agentFor(app);
    await loginWith(analistaA, tenantA.users.analista!.email, SENHA);

    // Um convite pendente no tenant B, para servir de alvo nas tentativas de acesso cruzado.
    const conviteCriado = await prisma.invite.create({
      data: {
        tenantId: tenantB.id,
        email: `alvo-${tenantB.slug}@teste.local`,
        role: 'viewer',
        tokenHash: `${'b'.repeat(63)}1`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    conviteB = { id: conviteCriado.id };

    // Um alerta aberto no tenant B: é o alvo das tentativas de reconhecer alerta alheio.
    alertaB = await tenantDb.run(tenantB.id, async (tx) => {
      const regra = await tx.alertRule.create({
        data: {
          tenantId: tenantB.id,
          name: 'Ruptura de item curva A',
          type: 'ruptura_curva_a',
          severity: 'alta',
          params: { minimoDeItens: 1 },
        },
      });

      return tx.alertEvent.create({
        data: {
          tenantId: tenantB.id,
          ruleId: regra.id,
          filialErpId: 1,
          dedupeKey: 'isolamento:1',
          severity: 'alta',
          payload: { resumo: `ruptura na ${tenantB.marcas[0]}` },
        },
        select: { id: true },
      });
    });
  });

  beforeEach(async () => {
    await clearRateLimits(app);
  });

  afterAll(async () => {
    await cleanupTenantFixtures(prisma);
    await app?.close();
  });

  // ------------------------------------------------------------------ banco
  describe('banco (RLS)', () => {
    it('nenhuma tabela com tenant_id fica sem RLS, FORCE e política', async () => {
      const lacunas = await prisma.rlsGaps();
      expect(lacunas).toEqual([]);
    });

    it('o papel da aplicação não tem BYPASSRLS', async () => {
      const [row] = await prisma.$queryRaw<Array<{ rolname: string; rolbypassrls: boolean }>>`
        SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user
      `;
      expect(row?.rolbypassrls).toBe(false);
    });

    it('consulta a dado de tenant SEM contexto falha em vez de devolver linhas', async () => {
      // Template estrito: a ausência de app.tenant_id é erro, não filtro vazio (doc 08 §3).
      await expect(prisma.$queryRaw`SELECT count(*) FROM erp_filiais`).rejects.toThrow();
    });

    it('com o contexto de A, o SQL cru não enxerga nem altera linhas de B', async () => {
      await tenantDb.run(tenantA.id, async (tx) => {
        const visiveis = await tx.$queryRaw<Array<{ tenant_id: string }>>`
          SELECT tenant_id FROM erp_filiais
        `;
        expect(visiveis.length).toBe(tenantA.filiais.length);
        expect(visiveis.every((linha) => linha.tenant_id === tenantA.id)).toBe(true);

        // Tentativas explícitas contra o tenant vizinho, por id, em SQL cru — o caminho que
        // burlaria qualquer filtro esquecido no ORM.
        // O `SELECT *` abaixo é o objeto do teste — é o atalho que um repositório desatento
        // usaria, e a RLS precisa barrá-lo mesmo assim.
        const lidas = await tx.$queryRawUnsafe<Array<unknown>>(
          // eslint-disable-next-line no-restricted-syntax -- ver comentário acima
          `SELECT * FROM erp_filiais WHERE tenant_id = '${tenantB.id}'`,
        );
        expect(lidas).toHaveLength(0);

        const atualizadas = await tx.$executeRawUnsafe(
          `UPDATE erp_filiais SET razao_social = 'invadido' WHERE tenant_id = '${tenantB.id}'`,
        );
        expect(atualizadas).toBe(0);

        const apagadas = await tx.$executeRawUnsafe(
          `DELETE FROM erp_filiais WHERE tenant_id = '${tenantB.id}'`,
        );
        expect(apagadas).toBe(0);
      });

      // E B continua intacto.
      const filiaisB = await tenantDb.run(tenantB.id, (tx) =>
        tx.erpFilial.findMany({ select: { razaoSocial: true } }),
      );
      expect(filiaisB).toHaveLength(tenantB.filiais.length);
      expect(filiaisB.every((filial) => filial.razaoSocial !== 'invadido')).toBe(true);
    });

    it('a escrita no contexto de A não consegue carimbar linha com o tenant de B', async () => {
      await expect(
        tenantDb.run(tenantA.id, (tx) =>
          tx.erpFilial.create({
            data: { tenantId: tenantB.id, erpId: 999, razaoSocial: 'contrabando' },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  // ------------------------------------------------------------------ API
  describe('API vista do tenant vizinho (A→B)', () => {
    /**
     * Rotas que não tocam dado de tenant. Ficam listadas com justificativa porque a suíte é
     * gerada do router: rota nova cai automaticamente no teste A→B até que alguém a classifique.
     */
    /**
     * Caminhos de infraestrutura, em qualquer verbo. O Nest registra as rotas excluídas do
     * prefixo para todos os métodos; nenhum deles toca dado de tenant.
     */
    const CAMINHOS_DE_INFRA = new Set(['/healthz', '/readyz', '/metrics']);

    const IDENTIDADE_OU_INFRA: Record<string, string> = {
      [`GET ${API_PREFIX}/meta`]: 'metadados públicos da instalação',
      [`POST ${API_PREFIX}/auth/login`]: 'identidade, antes de existir tenant',
      [`POST ${API_PREFIX}/auth/logout`]: 'encerra a própria sessão',
      [`POST ${API_PREFIX}/auth/mfa/verify`]: 'segundo fator da própria conta',
      [`POST ${API_PREFIX}/auth/mfa/setup`]: 'segundo fator da própria conta',
      [`POST ${API_PREFIX}/auth/mfa/enable`]: 'segundo fator da própria conta',
      [`POST ${API_PREFIX}/auth/mfa/disable`]: 'segundo fator da própria conta',
      [`POST ${API_PREFIX}/auth/password/forgot`]: 'recuperação de senha (pública)',
      [`POST ${API_PREFIX}/auth/password/reset`]: 'recuperação de senha (pública)',
      [`POST ${API_PREFIX}/auth/password/change`]: 'senha da própria conta',
      [`GET ${API_PREFIX}/auth/sessions`]: 'sessões da própria conta',
      [`DELETE ${API_PREFIX}/auth/sessions/:id`]:
        'sessão da própria conta (A→B por usuário no auth.int-spec)',
      [`POST ${API_PREFIX}/auth/tenant`]: 'escolhe entre os tenants do próprio usuário',
      [`GET ${API_PREFIX}/me`]: 'perfil da própria conta',
      [`GET ${API_PREFIX}/me/pending`]: 'perfil da própria conta (sessão parcial)',
      [`GET ${API_PREFIX}/me/security/recovery-codes/count`]: 'segundo fator da própria conta',
      [`GET ${API_PREFIX}/invites/preview`]: 'convite identificado pelo token, sem sessão',
      [`POST ${API_PREFIX}/invites/accept`]: 'convite identificado pelo token, sem sessão',
    };

    /** Mutações sem id na URL: criam no tenant da própria sessão. Cobertas em teste dedicado. */
    const MUTACOES_SEM_ID: Record<string, string> = {
      [`POST ${API_PREFIX}/tenant/invites`]:
        'convida no próprio tenant — ver "convites" em auth.int-spec',
      [`POST ${API_PREFIX}/platform/tenants`]: 'exige platform_admin — ver "plataforma"',
      [`PUT ${API_PREFIX}/tenant/erp-connection`]:
        'grava no próprio tenant — ver "cofre de credencial" em sg-integration.int-spec',
      [`POST ${API_PREFIX}/tenant/erp-connection/test`]:
        'testa a conexão do próprio tenant — ver "wizard de conexão" em sg-integration.int-spec',
      [`POST ${API_PREFIX}/tenant/sync/resync`]:
        'enfileira no próprio tenant — ver "painel" em sync.int-spec',
      [`POST ${API_PREFIX}/tenant/sync/backfill`]:
        'carga histórica do próprio tenant — ver "backfill" em sync.int-spec',
      [`DELETE ${API_PREFIX}/tenant/sync/backfill`]:
        'cancela a carga do próprio tenant — ver "backfill" em sync.int-spec',
      [`POST ${API_PREFIX}/alertas/avaliar`]:
        'avalia as regras do próprio tenant — ver "avaliação" em alertas.int-spec',
      [`POST ${API_PREFIX}/platform/retencao/executar`]:
        'exige platform_admin; não recebe tenant — ver retencao.int-spec',
      [`POST ${API_PREFIX}/platform/break-glass`]:
        'exige platform_admin e aprovação de outra pessoa — ver retencao.int-spec',
    };

    const rotas = (): RotaRegistrada[] => listarRotas(app);
    const chave = (rota: RotaRegistrada) => `${rota.method} ${rota.path}`;
    const ehInfra = (rota: RotaRegistrada) =>
      CAMINHOS_DE_INFRA.has(rota.path) || Boolean(IDENTIDADE_OU_INFRA[chave(rota)]);

    const alvosDeTenantVizinho = (): RotaRegistrada[] =>
      rotas().filter((rota) => !ehInfra(rota) && !MUTACOES_SEM_ID[chave(rota)]);

    /** Ids do tenant B para preencher os parâmetros de caminho. */
    const valorDoParametro = (rota: RotaRegistrada, nome: string): string => {
      if (nome === 'membershipId') return tenantB.users.dono!.membershipId;
      if (rota.path.includes('/platform/tenants/')) return tenantB.id;
      // Concessão de break-glass é registro de plataforma: para o dono de A, o id é apenas um
      // uuid qualquer — e a resposta certa continua sendo "isto não existe para você".
      if (rota.path.includes('/platform/break-glass/')) return tenantB.id;
      if (rota.path.includes('/tenant/invites/')) return conviteB.id;
      if (rota.path.includes('/alertas/')) return alertaB.id;
      throw new Error(`parâmetro :${nome} de ${rota.path} sem valor de tenant B definido`);
    };

    const corpoMinimo = (rota: RotaRegistrada): Record<string, unknown> | undefined => {
      const mapa: Record<string, Record<string, unknown>> = {
        [`PATCH ${API_PREFIX}/tenant/users/:membershipId`]: { role: 'viewer' },
        [`POST ${API_PREFIX}/platform/tenants/:id/suspend`]: { reason: 'teste de isolamento' },
        [`POST ${API_PREFIX}/platform/tenants/:id/offboard`]: {
          reason: 'teste de isolamento',
          confirmarSlug: 'nao-importa',
        },
        // Sem corpo, a validação recusaria antes de chegar à checagem de dono — e o que este
        // teste precisa provar é que A não desliga o alerta de B.
        [`PATCH ${API_PREFIX}/alertas/regras/:id`]: { enabled: false },
      };
      return mapa[chave(rota)];
    };

    it('toda rota do router é exercida ou justificada (nenhuma escapa da suíte)', () => {
      const todas = rotas();
      expect(todas.length).toBeGreaterThan(15);

      /**
       * Uma rota só está coberta se cair em um destes casos:
       *  - declarada como identidade/infra (não toca dado de tenant);
       *  - declarada como mutação sem id, apontando o teste dedicado que a cobre;
       *  - tem parâmetro → o teste abaixo a chama com ids do tenant vizinho;
       *  - é GET sem parâmetro → o teste de listagem varre a resposta atrás de marcas do vizinho.
       *
       * Sobra exatamente um caso perigoso: mutação sem id que ninguém declarou. É o endpoint
       * novo que alguém escreveu hoje e ainda não pensou em isolamento — e é por isso que ele
       * derruba o build.
       */
      const descobertas = todas.filter((rota) => {
        if (ehInfra(rota) || MUTACOES_SEM_ID[chave(rota)]) return false;
        return rota.params.length === 0 && rota.method !== 'GET';
      });

      expect(
        descobertas.map(
          (rota) =>
            `${chave(rota)} — classifique em IDENTIDADE_OU_INFRA ou MUTACOES_SEM_ID (com o teste que a cobre)`,
        ),
      ).toEqual([]);

      // Toda rota de dado de tenant com parâmetro precisa saber qual id de B usar.
      for (const rota of alvosDeTenantVizinho()) {
        for (const nome of rota.params) {
          expect(() => valorDoParametro(rota, nome)).not.toThrow();
        }
      }
    });

    it('nenhuma rota de tenant aceita id do vizinho', async () => {
      const comParametro = alvosDeTenantVizinho().filter((rota) => rota.params.length > 0);
      expect(comParametro.length).toBeGreaterThan(0);

      for (const rota of comParametro) {
        const valores = Object.fromEntries(
          rota.params.map((nome) => [nome, valorDoParametro(rota, nome)]),
        );
        const url = preencherParams(rota.path, valores);
        const metodo = rota.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete';

        let chamada = donoA[metodo](url).set('x-csrf-token', csrfDonoA);
        const corpo = corpoMinimo(rota);
        if (corpo) chamada = chamada.send(corpo);

        const resposta = await chamada;

        // 404 é a resposta certa: existir ou não, o recurso do vizinho não é assunto daqui
        // (doc 08 §4). 403 é aceito quando a barreira é de papel (painel da plataforma).
        expect({ rota: chave(rota), status: resposta.status }).toEqual({
          rota: chave(rota),
          status: expect.any(Number),
        });
        expect([403, 404]).toContain(resposta.status);
        expect(contemMarcaDe(resposta.body, tenantB)).toBeNull();
      }
    });

    it('nenhuma listagem devolve dado do vizinho', async () => {
      const listagens = alvosDeTenantVizinho().filter(
        (rota) => rota.method === 'GET' && rota.params.length === 0,
      );
      expect(listagens.length).toBeGreaterThan(0);

      for (const rota of listagens) {
        const resposta = await donoA.get(rota.path);
        // 422 entra na lista porque há listagens com filtro obrigatório (o diário de vendas pede
        // a data): requisição recusada na validação não chega a consultar nada, e o corpo do erro
        // não carrega dado de tenant nenhum — o que esta suíte precisa provar continua provado.
        expect([200, 403, 404, 422]).toContain(resposta.status);

        const marca = contemMarcaDe(resposta.body, tenantB);
        expect({ rota: chave(rota), marca }).toEqual({ rota: chave(rota), marca: null });
      }
    });

    it('o dono de A administra apenas os membros de A', async () => {
      const membros = await donoA.get(`${API_PREFIX}/tenant/users`).expect(200);
      const emails = membros.body.map((membro: { user: { email: string } }) => membro.user.email);

      expect(emails).toContain(tenantA.users.dono!.email);
      expect(emails).toContain(tenantA.users.analista!.email);
      expect(emails).not.toContain(tenantB.users.dono!.email);
    });
  });

  // ------------------------------------------------------------------ filiais
  describe('recorte por filial (filiais_allowed)', () => {
    it('a listagem devolve só as filiais permitidas', async () => {
      const resposta = await analistaA.get(`${API_PREFIX}/dim/filiais`).expect(200);
      expect(resposta.body.map((filial: { erpId: number }) => filial.erpId)).toEqual([1]);
    });

    it('pedir filial fora do recorte é 403, não lista vazia', async () => {
      const resposta = await analistaA.get(`${API_PREFIX}/dim/filiais?filiais=2`).expect(403);
      expect(resposta.body.code).toBe('FORBIDDEN');
    });

    it('quem não tem recorte enxerga todas as filiais do tenant', async () => {
      const resposta = await donoA.get(`${API_PREFIX}/dim/filiais`).expect(200);
      expect(resposta.body).toHaveLength(tenantA.filiais.length);
    });

    it('parâmetro malformado é erro de validação, não filtro silencioso', async () => {
      const resposta = await donoA.get(`${API_PREFIX}/dim/filiais?filiais=1;drop`).expect(422);
      expect(resposta.body.code).toBe('VALIDATION_ERROR');
    });

    it('alterar o recorte muda o que a pessoa enxerga', async () => {
      const membershipId = tenantA.users.analista!.membershipId;
      await donoA
        .patch(`${API_PREFIX}/tenant/users/${membershipId}`)
        .set('x-csrf-token', csrfDonoA)
        .send({ filiaisAllowed: [1, 3] })
        .expect(200);

      const resposta = await analistaA.get(`${API_PREFIX}/dim/filiais`).expect(200);
      expect(resposta.body.map((filial: { erpId: number }) => filial.erpId)).toEqual([1, 3]);

      await donoA
        .patch(`${API_PREFIX}/tenant/users/${membershipId}`)
        .set('x-csrf-token', csrfDonoA)
        .send({ filiaisAllowed: [1] })
        .expect(200);
    });
  });

  // ------------------------------------------------------------------ cache
  describe('cache', () => {
    it('toda chave de tenant nasce com o prefixo do tenant', async () => {
      await redis.setTenantJson(tenantA.id, ['kpi', 'overview'], { valor: 1 }, 30);
      const chaves = await redis.client.keys(`t:${tenantA.id}:*`);

      expect(chaves).toContain(tenantCacheKey(tenantA.id, 'kpi', 'overview'));
      expect(chaves.every((chave) => chave.startsWith(`t:${tenantA.id}:`))).toBe(true);
    });

    it('recusa chave de tenant sem tenant', () => {
      expect(() => tenantCacheKey('', 'kpi')).toThrow('isolamento');
    });

    it('a limpeza de um tenant não encosta no cache do vizinho', async () => {
      await redis.setTenantJson(tenantA.id, ['ping'], { a: true }, 60);
      await redis.setTenantJson(tenantB.id, ['ping'], { b: true }, 60);

      await redis.purgeTenant(tenantA.id);

      expect(await redis.getTenantJson(tenantA.id, 'ping')).toBeNull();
      expect(await redis.getTenantJson(tenantB.id, 'ping')).toEqual({ b: true });
    });
  });

  // ------------------------------------------------------------------ jobs
  describe('jobs (workers)', () => {
    it('jobs de tenants diferentes processados juntos não misturam contexto', async () => {
      const trabalho = async (fixture: TenantFixture) =>
        tenantDb.runJob({ tenantId: fixture.id, jobId: `job-${fixture.slug}` }, async (tx) => {
          // Espera embaralhada: se o contexto vazasse entre tarefas, seria aqui.
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 30));
          const filiais = await tx.erpFilial.findMany({ select: { tenantId: true } });
          return { tenantId: fixture.id, filiais };
        });

      const resultados = await Promise.all([
        trabalho(tenantA),
        trabalho(tenantB),
        trabalho(tenantA),
        trabalho(tenantB),
      ]);

      for (const resultado of resultados) {
        expect(resultado.filiais.every((filial) => filial.tenantId === resultado.tenantId)).toBe(
          true,
        );
      }
      expect(resultados[0]!.filiais).toHaveLength(tenantA.filiais.length);
      expect(resultados[1]!.filiais).toHaveLength(tenantB.filiais.length);
    });

    it('contexto de tenant inválido é recusado antes de tocar o banco', async () => {
      await expect(tenantDb.run("' OR 1=1 --", async () => 'nunca')).rejects.toThrow('UUID');
    });
  });

  // ------------------------------------------------------------------ plataforma
  describe('administração da plataforma (runbooks 22 §1 e §2)', () => {
    let plataforma: TestAgent;
    let csrfPlataforma: string;

    beforeAll(async () => {
      // Conta de operação: papel global, sem vínculo com tenant nenhum (doc 07 §2).
      const operador = await prisma.user.create({
        data: {
          email: `plataforma-${Date.now()}@teste.local`,
          name: 'Operação',
          status: 'active',
          platformAdmin: true,
          passwordHash: (
            await prisma.user.findUniqueOrThrow({
              where: { id: tenantA.users.dono!.id },
              select: { passwordHash: true },
            })
          ).passwordHash,
        },
      });

      plataforma = agentFor(app);
      const sessao = await loginWith(plataforma, operador.email, SENHA, { enrollMfa: true });
      csrfPlataforma = sessao.csrf;
    });

    it('conta de tenant não enxerga o painel (404, não 403)', async () => {
      const resposta = await donoA.get(`${API_PREFIX}/platform/tenants`).expect(404);
      expect(resposta.body.code).toBe('NOT_FOUND');
    });

    it('provisiona tenant já convidando o owner (runbook 22 §1)', async () => {
      const slug = `teste-novo-${Date.now().toString(36)}`;
      const criado = await plataforma
        .post(`${API_PREFIX}/platform/tenants`)
        .set('x-csrf-token', csrfPlataforma)
        .send({
          name: 'Rede Recem Criada',
          slug,
          plan: 'beta',
          ownerEmail: `dono-${slug}@teste.local`,
        })
        .expect(201);

      expect(criado.body).toMatchObject({ slug });

      const convite = await prisma.invite.findFirst({
        where: { tenantId: criado.body.id, role: 'owner' },
      });
      expect(convite).not.toBeNull();
    });

    it('suspende e reativa: login bloqueado, sessões derrubadas, dados preservados', async () => {
      const suspenso = await createTenantFixture(app, {
        password: SENHA,
        filiais: [1],
        users: [{ chave: 'gerente', role: 'manager' }],
      });
      const gerente = suspenso.users.gerente!;

      const sessao = agentFor(app);
      await loginWith(sessao, gerente.email, SENHA);
      await sessao.get(`${API_PREFIX}/me`).expect(200);

      await plataforma
        .post(`${API_PREFIX}/platform/tenants/${suspenso.id}/suspend`)
        .set('x-csrf-token', csrfPlataforma)
        .send({ reason: 'inadimplência contratual (teste)' })
        .expect(204);

      // Sessão aberta cai na hora e o próximo login é recusado.
      await sessao.get(`${API_PREFIX}/me`).expect(401);
      const recusa = await agentFor(app)
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: gerente.email, password: SENHA })
        .expect(403);
      expect(recusa.body.code).toBe('FORBIDDEN');

      // Suspensão não é offboarding: os dados continuam lá (doc 08 §5).
      const filiais = await tenantDb.run(suspenso.id, (tx) => tx.erpFilial.findMany());
      expect(filiais).toHaveLength(1);

      await plataforma
        .post(`${API_PREFIX}/platform/tenants/${suspenso.id}/resume`)
        .set('x-csrf-token', csrfPlataforma)
        .expect(204);

      const reativado = agentFor(app);
      await reativado
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: gerente.email, password: SENHA })
        .expect(200);
      await reativado.get(`${API_PREFIX}/me`).expect(200);
    });

    it('registra quem suspendeu e por quê', async () => {
      const evento = await prisma.auditLog.findFirst({
        where: { action: 'platform.tenant_suspended' },
        orderBy: { id: 'desc' },
      });

      expect(evento?.userId).toBeTruthy();
      expect(JSON.stringify(evento?.changes)).toContain('inadimplência');
    });
  });
});
