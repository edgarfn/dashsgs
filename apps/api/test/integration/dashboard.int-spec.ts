import { API_PREFIX } from '@dashsgs/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../../src/app.module';
import { correlationMiddleware } from '../../src/common/correlation/correlation.middleware';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { RedisService } from '../../src/common/redis/redis.service';
import { TenantDatabase } from '../../src/common/tenant';
import { MOCK_SENHA, MOCK_USUARIO } from '../../src/integration/sg/mock/sg-mock.transport';
import { SyncService } from '../../src/modules/sync/sync.service';
import { agentFor, clearRateLimits, loginWith } from './helpers/auth.helpers';
import {
  cleanupTenantFixtures,
  createTenantFixture,
  type TenantFixture,
} from './helpers/tenant.helpers';

const SENHA = 'Cavalo-Bateria-Grampo-Correto-9';
const BASE_URL = 'http://example.com:8201';

/**
 * Dashboard (épico E7) sobre dados reais do espelho.
 *
 * Os cenários **sincronizam de verdade** (contra o mock da SG) antes de consultar: testar o
 * dashboard com linhas inseridas à mão provaria que o SQL roda, não que o produto mostra o que o
 * ERP mandou. O que interessa aqui é a cadeia inteira — ERP → espelho → agregado → tela.
 */
describe('dashboard (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantDb: TenantDatabase;
  let redis: RedisService;
  let sync: SyncService;

  let tenant: TenantFixture;
  let dono: TestAgent;
  let analista: TestAgent;
  let gerenteDeUmaFilial: TestAgent;
  let consulta: TestAgent;
  let csrf: string;

  const hoje = () => new Date().toISOString().slice(0, 10);
  const ontem = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

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
    sync = app.get(SyncService);

    await clearRateLimits(app);

    tenant = await createTenantFixture(app, {
      password: SENHA,
      filiais: [1, 2],
      users: [
        { chave: 'dono', role: 'owner' },
        { chave: 'analista', role: 'analyst' },
        { chave: 'gerente', role: 'manager', filiaisAllowed: [1] },
        { chave: 'consulta', role: 'viewer' },
      ],
    });

    dono = agentFor(app);
    csrf = (await loginWith(dono, tenant.users.dono!.email, SENHA, { enrollMfa: true })).csrf;

    analista = agentFor(app);
    await loginWith(analista, tenant.users.analista!.email, SENHA);

    gerenteDeUmaFilial = agentFor(app);
    await loginWith(gerenteDeUmaFilial, tenant.users.gerente!.email, SENHA);

    consulta = agentFor(app);
    await loginWith(consulta, tenant.users.consulta!.email, SENHA);

    await dono.put(`${API_PREFIX}/tenant/erp-connection`).set('x-csrf-token', csrf).send({
      baseUrl: BASE_URL,
      username: MOCK_USUARIO,
      senha: MOCK_SENHA,
      isSgCloud: false,
      tlsMode: 'https',
      maxRps: 20,
    });

    // Sincroniza o mínimo para o dashboard ter o que mostrar.
    await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });
    await sync.executar({ tenantId: tenant.id, domain: 'produtos' });
    for (const filial of [1, 2]) {
      await sync.executar({ tenantId: tenant.id, domain: 'vendas_hoje', filialErpId: filial });
      await sync.executar({ tenantId: tenant.id, domain: 'resumo_filial', filialErpId: filial });
      // Um dia fechado também: é nele que existem cupons cancelados e o consolidado do painel.
      await sync.executar({
        tenantId: tenant.id,
        domain: 'vendas_dia',
        filialErpId: filial,
        data: ontem(),
        trigger: 'manual',
      });
    }
  });

  beforeEach(async () => {
    await clearRateLimits(app);
    // Cada cenário começa sem cache: senão o segundo teste leria a resposta do primeiro.
    await redis.purgeTenant(tenant.id);
  });

  afterAll(async () => {
    await cleanupTenantFixtures(prisma);
    await app?.close();
  });

  // ------------------------------------------------------------------ home
  describe('visão executiva (E7-01)', () => {
    it('mostra o dia corrente com curva, filiais e frescor', async () => {
      const { body } = await dono.get(`${API_PREFIX}/dashboard/home`).expect(200);

      expect(body.hoje.data).toBe(hoje());
      expect(body.hoje.venda).toBeGreaterThan(0);
      expect(body.hoje.cupons).toBeGreaterThan(0);
      expect(body.hoje.ticketMedio).toBeCloseTo(body.hoje.venda / body.hoje.cupons, 6);
      expect(body.hoje.porFilial.length).toBeGreaterThan(0);
      expect(body.hoje.curva.length).toBeGreaterThan(0);

      // O dia corrente é provisório até o ERP fechar — a tela precisa saber disso.
      expect(body.hoje.frescor.provisorio).toBe(true);
      expect(body.hoje.frescor.atualizadoEm).toBeTruthy();
      expect(body.semDados).toBe(false);
    });

    it('traz o último dia fechado com comparação do mesmo dia da semana anterior', async () => {
      const { body } = await dono.get(`${API_PREFIX}/dashboard/home`).expect(200);

      expect(body.consolidado.data).toBeTruthy();
      expect(body.consolidado.data < hoje()).toBe(true);
      expect(body.consolidado.venda).toBeGreaterThan(0);
      expect(body.consolidado.vendaSemanaAnterior).toBeGreaterThan(0);
      expect(typeof body.consolidado.variacaoPct).toBe('number');
    });

    it('margem e status de fechamento ficam com manager+ (doc 15 §1)', async () => {
      const doDono = await dono.get(`${API_PREFIX}/dashboard/home`).expect(200);
      expect(doDono.body.consolidado.margemPct).toBeGreaterThan(0);
      expect(doDono.body.fechamento.length).toBeGreaterThan(0);

      const doAnalista = await analista.get(`${API_PREFIX}/dashboard/home`).expect(200);
      expect(doAnalista.body.consolidado.margemPct).toBeNull();
      expect(doAnalista.body.fechamento).toEqual([]);
      // Mas o analista continua vendo a venda: o que muda é o custo, não o faturamento.
      expect(doAnalista.body.consolidado.venda).toBeGreaterThan(0);
    });

    it('a base de custo muda a margem (o ERP tem cinco, e elas não são iguais)', async () => {
      const medio = await dono.get(`${API_PREFIX}/dashboard/home?custo=medio`).expect(200);
      const comEncargos = await dono
        .get(`${API_PREFIX}/dashboard/home?custo=com_encargos`)
        .expect(200);

      expect(medio.body.consolidado.baseDeCusto).toBe('medio');
      expect(comEncargos.body.consolidado.baseDeCusto).toBe('com_encargos');
      expect(comEncargos.body.consolidado.margemPct).not.toBe(medio.body.consolidado.margemPct);
    });

    it('respeita o recorte de filiais da membership', async () => {
      const completo = await dono.get(`${API_PREFIX}/dashboard/home`).expect(200);
      const restrito = await gerenteDeUmaFilial.get(`${API_PREFIX}/dashboard/home`).expect(200);

      expect(completo.body.hoje.porFilial.length).toBeGreaterThan(1);
      expect(restrito.body.hoje.porFilial).toHaveLength(1);
      expect(restrito.body.hoje.porFilial[0].filialErpId).toBe(1);
      expect(restrito.body.hoje.venda).toBeLessThan(completo.body.hoje.venda);
    });

    it('pedir filial fora do recorte é 403, não lista vazia', async () => {
      await gerenteDeUmaFilial.get(`${API_PREFIX}/dashboard/home?filiais=2`).expect(403);
    });

    it('a resposta é servida do cache na segunda chamada', async () => {
      const primeira = await dono.get(`${API_PREFIX}/dashboard/home`).expect(200);

      const chaves = await redis.client.keys(`t:${tenant.id}:q:home:*`);
      expect(chaves).toHaveLength(1);

      // Um cupom novo entra no espelho: a segunda resposta ainda é a cacheada (TTL de 60 s),
      // e é isso que segura o banco quando a rede inteira abre o painel às 8h.
      await tenantDb.run(tenant.id, (tx) =>
        tx.erpVendaCupom.create({
          data: {
            tenantId: tenant.id,
            filialErpId: 1,
            data: new Date(`${hoje()}T00:00:00Z`),
            caixa: 99,
            cupom: 999_999,
            valorTotal: 1_234,
            horario: '23:59',
          },
        }),
      );

      const segunda = await dono.get(`${API_PREFIX}/dashboard/home`).expect(200);
      expect(segunda.body.hoje.venda).toBe(primeira.body.hoje.venda);

      // Invalidar a chave devolve o número novo — o cache atrasa, não esconde.
      await redis.client.del(...chaves);
      const terceira = await dono.get(`${API_PREFIX}/dashboard/home`).expect(200);
      expect(terceira.body.hoje.venda).toBeGreaterThan(primeira.body.hoje.venda);

      await tenantDb.run(tenant.id, (tx) => tx.erpVendaCupom.deleteMany({ where: { caixa: 99 } }));
    });
  });

  // ------------------------------------------------------------------ vendas
  describe('vendas do dia (E7-02)', () => {
    it('lista cupons com itens, formas de pagamento e totais', async () => {
      const { body } = await dono
        .get(`${API_PREFIX}/dashboard/vendas/dia?data=${hoje()}`)
        .expect(200);

      expect(body.cupons.length).toBeGreaterThan(0);
      expect(body.cupons[0]).toMatchObject({ data: hoje() });
      expect(body.cupons[0].itens).toBeGreaterThan(0);
      expect(body.cupons[0].formas.length).toBeGreaterThan(0);

      expect(body.totais.venda).toBeGreaterThan(0);
      expect(body.totais.itensPorCupom).toBeGreaterThan(0);
      expect(body.formasDePagamento.length).toBeGreaterThan(0);
      expect(
        body.formasDePagamento.reduce(
          (soma: number, forma: { participacaoPct: number }) => soma + forma.participacaoPct,
          0,
        ),
      ).toBeCloseTo(100, 1);
    });

    it('separa cancelados do faturamento', async () => {
      const todos = await dono
        .get(`${API_PREFIX}/dashboard/vendas/dia?data=${ontem()}`)
        .expect(200);
      const cancelados = await dono
        .get(`${API_PREFIX}/dashboard/vendas/dia?data=${ontem()}&canceladas=true`)
        .expect(200);

      // Cupom cancelado continua na base (auditoria) mas não entra na venda: por isso o total de
      // linhas é maior que a contagem de cupons faturados.
      expect(todos.body.paginacao.total).toBeGreaterThan(todos.body.totais.cupons);
      expect(todos.body.totais.valorCancelado).toBeGreaterThan(0);
      expect(cancelados.body.cupons.length).toBeGreaterThan(0);
      for (const cupom of cancelados.body.cupons) expect(cupom.cancelada).toBe(true);
    });

    it('pagina sem perder o total', async () => {
      const { body } = await dono
        .get(`${API_PREFIX}/dashboard/vendas/dia?data=${hoje()}&itensPorPagina=10&pagina=1`)
        .expect(200);

      expect(body.paginacao.itensPorPagina).toBe(10);
      expect(body.paginacao.paginas).toBe(Math.max(1, Math.ceil(body.paginacao.total / 10)));
    });

    it('recusa data malformada antes de tocar no banco', async () => {
      await dono.get(`${API_PREFIX}/dashboard/vendas/dia?data=13-09-2026`).expect(422);
    });

    it('comparativo devolve série, ranking de filiais e corte por departamento', async () => {
      const de = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
      const { body } = await dono
        .get(`${API_PREFIX}/dashboard/vendas/comparativo?de=${de}&ate=${hoje()}`)
        .expect(200);

      expect(body.serie.length).toBeGreaterThan(0);
      expect(body.totais.venda).toBeGreaterThan(0);
      expect(body.porFilial.length).toBeGreaterThan(0);
      expect(
        body.porFilial.reduce(
          (soma: number, filial: { participacaoPct: number }) => soma + filial.participacaoPct,
          0,
        ),
      ).toBeCloseTo(100, 1);
      expect(body.porDiaDaSemana.length).toBeGreaterThan(0);
    });

    it('recusa período invertido e período longo demais', async () => {
      await dono
        .get(`${API_PREFIX}/dashboard/vendas/comparativo?de=${hoje()}&ate=2020-01-01`)
        .expect(422);

      await dono
        .get(`${API_PREFIX}/dashboard/vendas/comparativo?de=2020-01-01&ate=${hoje()}`)
        .expect(422);
    });
  });

  // ------------------------------------------------------------------ export
  describe('export CSV (doc 16 §4)', () => {
    it('entrega o arquivo com separador e BOM que o Excel pt-BR entende', async () => {
      const resposta = await dono
        .get(`${API_PREFIX}/dashboard/vendas/dia/export?data=${hoje()}`)
        .expect(200);

      expect(resposta.headers['content-type']).toContain('text/csv');
      expect(resposta.headers['content-disposition']).toContain('vendas-');
      expect(resposta.text.charCodeAt(0)).toBe(0xfeff);
      expect(resposta.text.split('\r\n')[0]).toContain('Cupom;');
    });

    it('quem só consulta não exporta — ler e levar embora são atos diferentes', async () => {
      // O papel viewer enxerga o painel, mas não tem `reports.export` (doc 07 §3): tirar o dado
      // do produto é uma decisão de privacidade à parte (doc 10 §3).
      await consulta.get(`${API_PREFIX}/dashboard/home`).expect(200);
      await consulta.get(`${API_PREFIX}/dashboard/vendas/dia/export?data=${hoje()}`).expect(403);

      // O analista, que tem a permissão, exporta normalmente.
      await analista.get(`${API_PREFIX}/dashboard/vendas/dia/export?data=${hoje()}`).expect(200);
    });
  });

  // ------------------------------------------------------------------ estoque
  describe('estoque (E7-04 parcial)', () => {
    it('lista ruptura com contagens e prioriza a curva A', async () => {
      await tenantDb.run(tenant.id, (tx) =>
        tx.erpProduto.updateMany({
          where: { erpId: 1001 },
          data: { estoqueAtual: 1, estoqueMinimo: 10, curvaAbc: 'A', vendaMediaDiaria: 5 },
        }),
      );
      await tenantDb.run(tenant.id, (tx) =>
        tx.erpProduto.updateMany({
          where: { erpId: 1002 },
          data: { estoqueAtual: 2, estoqueMinimo: 8, curvaAbc: 'C', vendaMediaDiaria: 1 },
        }),
      );

      const { body } = await dono.get(`${API_PREFIX}/dashboard/estoque`).expect(200);

      expect(body.situacao).toBe('ruptura');
      expect(body.contagens.ruptura).toBeGreaterThanOrEqual(2);
      expect(body.contagens.curvaAEmRuptura).toBeGreaterThanOrEqual(1);
      expect(body.produtos[0].curvaAbc).toBe('A');
      expect(body.produtos[0].coberturaDias).toBeCloseTo(0.2, 3);
    });

    it('filtra por curva e por situação', async () => {
      const curvaA = await dono.get(`${API_PREFIX}/dashboard/estoque?curva=A`).expect(200);
      for (const produto of curvaA.body.produtos) expect(produto.curvaAbc).toBe('A');

      await tenantDb.run(tenant.id, (tx) =>
        tx.erpProduto.updateMany({ where: { erpId: 1002 }, data: { estoqueAtual: -3 } }),
      );

      const negativos = await dono
        .get(`${API_PREFIX}/dashboard/estoque?situacao=negativo`)
        .expect(200);
      expect(negativos.body.produtos.length).toBeGreaterThan(0);
      for (const produto of negativos.body.produtos) expect(produto.estoqueAtual).toBeLessThan(0);
    });
  });

  // ------------------------------------------------------------------ estado vazio
  describe('estados vazios (E7-05)', () => {
    it('tenant sem sincronização devolve vazio explicável, não erro', async () => {
      const outro = await createTenantFixture(app, {
        password: SENHA,
        filiais: [1],
        users: [{ chave: 'dono', role: 'owner' }],
      });

      const agente = agentFor(app);
      await loginWith(agente, outro.users.dono!.email, SENHA, { enrollMfa: true });

      const { body } = await agente.get(`${API_PREFIX}/dashboard/home`).expect(200);

      expect(body.semDados).toBe(true);
      expect(body.hoje.venda).toBe(0);
      expect(body.consolidado.data).toBeNull();
      // Nunca sincronizou = atrasado: a tela diz isso em vez de fingir frescor.
      expect(body.hoje.frescor.atualizadoEm).toBeNull();
      expect(body.hoje.frescor.atrasado).toBe(true);
    });
  });
});
