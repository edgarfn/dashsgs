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
import { AlertEngine } from '../../src/modules/alertas/alert-engine.service';
import { AlertRulesService } from '../../src/modules/alertas/alert-rules.service';
import { SyncService } from '../../src/modules/sync/sync.service';
import { agentFor, clearRateLimits, loginWith } from './helpers/auth.helpers';
import {
  cleanupTenantFixtures,
  createTenantFixture,
  type TenantFixture,
} from './helpers/tenant.helpers';

const SENHA = 'Cavalo-Bateria-Grampo-Correto-9';
const BASE_URL = 'http://example.com:8201';

interface MetasResposta {
  competencia: string;
  diaDoMes: number;
  diasNoMes: number;
  base: 'curva_diaria' | 'proporcional' | 'sem_base';
  total: {
    meta: number;
    realizado: number;
    esperadoAteHoje: number;
    projecao: number;
    ritmo: number;
  };
  porFilial: Array<{
    filialErpId: number;
    filialNome: string;
    meta: number;
    realizado: number;
    projecao: number;
    ritmo: number;
    diasUteis: number | null;
  }>;
  curva: Array<{ data: string; previsto: number; realizado: number }>;
}

/**
 * Metas: previsão do ERP → tela → alerta (E5-11 / E7-03 / doc 15 §7).
 *
 * A cadeia inteira num arquivo de propósito. Cada elo sozinho é fácil de fazer passar com dado
 * de mentira; o que interessa é que a meta que o ERP lançou seja a meta que a tela mostra e a
 * meta sobre a qual o alerta decide — sem ninguém traduzir duas vezes pelo caminho.
 */
describe('metas (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantDb: TenantDatabase;
  let redis: RedisService;
  let sync: SyncService;
  let engine: AlertEngine;
  let regras: AlertRulesService;

  let tenant: TenantFixture;
  let dono: TestAgent;
  let csrf: string;

  const hoje = () => new Date().toISOString().slice(0, 10);
  const competencia = () => hoje().slice(0, 7);

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
    engine = app.get(AlertEngine);
    regras = app.get(AlertRulesService);

    await clearRateLimits(app);

    tenant = await createTenantFixture(app, {
      password: SENHA,
      filiais: [],
      users: [{ chave: 'dono', role: 'owner' }],
    });

    dono = agentFor(app);
    const sessao = await loginWith(dono, tenant.users.dono!.email, SENHA, { enrollMfa: true });
    csrf = sessao.csrf;

    await dono.put(`${API_PREFIX}/tenant/erp-connection`).set('x-csrf-token', csrf).send({
      baseUrl: BASE_URL,
      username: MOCK_USUARIO,
      senha: MOCK_SENHA,
      isSgCloud: false,
      tlsMode: 'https',
      maxRps: 20,
    });
  });

  beforeEach(async () => {
    await clearRateLimits(app);
    // Cada cenário começa sem cache: o painel guarda a resposta por 60 s, e o segundo teste leria
    // o "sem_base" do primeiro.
    await redis.purgeTenant(tenant.id);
    await limpar();
  });

  afterAll(async () => {
    await cleanupTenantFixtures(prisma);
    await app?.close();
  });

  async function limpar(): Promise<void> {
    await tenantDb.run(tenant.id, async (tx) => {
      await tx.alertEvent.deleteMany({});
      await tx.erpPrevisaoVendasDiaria.deleteMany({});
      await tx.erpPrevisaoVendas.deleteMany({});
      await tx.erpFilialVendaResumo.deleteMany({});
      await tx.erpFilial.deleteMany({});
      await tx.syncWatermark.deleteMany({});
      await tx.syncJobRun.deleteMany({});
    });
  }

  /** Filial com nome, para que a mensagem do alerta não diga "filial 1". */
  async function criarFilial(erpId: number, nome: string): Promise<void> {
    await tenantDb.run(tenant.id, (tx) =>
      tx.erpFilial.create({
        data: { tenantId: tenant.id, erpId, razaoSocial: nome, nomeFantasia: nome },
      }),
    );
  }

  async function lancarMeta(params: {
    filialErpId: number;
    meta: number;
    diasUteis?: number;
    comCurva?: boolean;
  }): Promise<void> {
    const primeiroDia = `${competencia()}-01`;
    const diasNoMes = new Date(
      Date.UTC(Number(competencia().slice(0, 4)), Number(competencia().slice(5, 7)), 0),
    ).getUTCDate();

    await tenantDb.run(tenant.id, async (tx) => {
      await tx.erpPrevisaoVendas.create({
        data: {
          tenantId: tenant.id,
          filialErpId: params.filialErpId,
          competencia: new Date(`${primeiroDia}T00:00:00Z`),
          previsaoVenda: params.meta,
          diasUteis: params.diasUteis ?? 26,
        },
      });

      if (params.comCurva) {
        for (let dia = 1; dia <= diasNoMes; dia += 1) {
          await tx.erpPrevisaoVendasDiaria.create({
            data: {
              tenantId: tenant.id,
              filialErpId: params.filialErpId,
              data: new Date(`${competencia()}-${String(dia).padStart(2, '0')}T00:00:00Z`),
              previsaoVenda: params.meta / diasNoMes,
            },
          });
        }
      }
    });
  }

  /** Vende `valor` por dia, do dia 1 ao dia de hoje. */
  async function venderNoMes(filialErpId: number, valorPorDia: number): Promise<void> {
    const diaDeHoje = Number(hoje().slice(8, 10));

    await tenantDb.run(tenant.id, async (tx) => {
      for (let dia = 1; dia <= diaDeHoje; dia += 1) {
        await tx.erpFilialVendaResumo.create({
          data: {
            tenantId: tenant.id,
            filialErpId,
            data: new Date(`${competencia()}-${String(dia).padStart(2, '0')}T00:00:00Z`),
            valor: valorPorDia,
            gerouVendasDiaria: true,
          },
        });
      }
    });
  }

  const buscarMetas = async (query = '') => {
    const resposta = await dono.get(`${API_PREFIX}/dashboard/metas${query}`).expect(200);
    return resposta.body as MetasResposta;
  };

  // ------------------------------------------------------------------ sincronização
  describe('sincronização da previsão (E5-11)', () => {
    it('traz a meta do mês e a curva diária do ERP', async () => {
      const desfecho = await sync.executar({
        tenantId: tenant.id,
        domain: 'previsao',
        trigger: 'manual',
      });

      expect(desfecho.status).toBe('success');

      const gravadas = await tenantDb.run(tenant.id, async (tx) => ({
        mensais: await tx.erpPrevisaoVendas.count(),
        diarias: await tx.erpPrevisaoVendasDiaria.count(),
      }));

      // Mês corrente + próximo, duas filiais no mock: quatro competências.
      expect(gravadas.mensais).toBe(4);
      expect(gravadas.diarias).toBeGreaterThan(50);
    });

    it('repetir não duplica (idempotência do doc 14 §1)', async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'previsao', trigger: 'manual' });
      const primeira = await tenantDb.run(tenant.id, (tx) => tx.erpPrevisaoVendas.count());

      await sync.executar({ tenantId: tenant.id, domain: 'previsao', trigger: 'manual' });
      const segunda = await tenantDb.run(tenant.id, (tx) => tx.erpPrevisaoVendas.count());

      expect(segunda).toBe(primeira);
    });
  });

  // ------------------------------------------------------------------ tela
  describe('painel de metas (E7-03)', () => {
    it('sem previsão lançada, a tela diz que não há base — e não mostra zeros', async () => {
      const metas = await buscarMetas();

      expect(metas.base).toBe('sem_base');
      expect(metas.porFilial).toEqual([]);
    });

    it('projeta o fechamento pelo ritmo e ordena da pior filial para a melhor', async () => {
      await criarFilial(1, 'Centro');
      await criarFilial(2, 'Zona Sul');

      const diaDeHoje = Number(hoje().slice(8, 10));
      // Uma loja no ritmo exato da meta, outra na metade dele.
      await lancarMeta({ filialErpId: 1, meta: 30_000, comCurva: true });
      await lancarMeta({ filialErpId: 2, meta: 30_000, comCurva: true });
      await venderNoMes(1, 1_000);
      await venderNoMes(2, 500);

      const metas = await buscarMetas();

      expect(metas.base).toBe('curva_diaria');
      expect(metas.competencia).toBe(competencia());
      expect(metas.diaDoMes).toBe(diaDeHoje);

      // A pior primeiro: é ela que precisa de ação, e quem abre a tela não deve ter de procurar.
      expect(metas.porFilial.map((filial) => filial.filialNome)).toEqual(['Zona Sul', 'Centro']);

      const centro = metas.porFilial.find((filial) => filial.filialErpId === 1)!;
      const zonaSul = metas.porFilial.find((filial) => filial.filialErpId === 2)!;

      // Curva uniforme + venda uniforme ⇒ a projeção é o mês inteiro no mesmo passo.
      expect(centro.realizado).toBe(diaDeHoje * 1_000);
      expect(centro.projecao).toBeCloseTo(30_000 * (metas.diasNoMes / metas.diasNoMes), 0);
      expect(centro.ritmo).toBeCloseTo(100, 0);
      expect(zonaSul.ritmo).toBeCloseTo(50, 0);
    });

    it('sem curva diária, a projeção cai na proporcional e a tela declara isso', async () => {
      await criarFilial(1, 'Centro');
      await lancarMeta({ filialErpId: 1, meta: 30_000, comCurva: false });
      await venderNoMes(1, 1_000);

      const metas = await buscarMetas();

      expect(metas.base).toBe('proporcional');
      expect(metas.porFilial).toHaveLength(1);
      expect(metas.porFilial[0]!.projecao).toBeGreaterThan(0);
    });

    it('mês fechado é medido até o último dia dele, não até hoje', async () => {
      await criarFilial(1, 'Centro');
      await lancarMeta({ filialErpId: 1, meta: 30_000, comCurva: true });
      await venderNoMes(1, 1_000);

      // Competência antiga e sem lançamento: o corte não pode ser "hoje", senão a tela diria
      // que o mês de 2026-01 ainda tem dias para vender.
      const metas = await buscarMetas('?competencia=2026-01');

      expect(metas.competencia).toBe('2026-01');
      expect(metas.diaDoMes).toBe(31);
      expect(metas.base).toBe('sem_base');
    });

    it('recusa competência malformada', async () => {
      // 422 é o código do contrato de erro do produto para validação (doc 23 §Erros).
      await dono.get(`${API_PREFIX}/dashboard/metas?competencia=2026-13`).expect(422);
      await dono.get(`${API_PREFIX}/dashboard/metas?competencia=setembro`).expect(422);
    });
  });

  // ------------------------------------------------------------------ alerta
  describe('alerta de meta em risco (doc 15 §8)', () => {
    async function ligarRegra(diaDoMes: number): Promise<void> {
      const lista = await regras.listar(tenant.id);
      const meta = lista.find((regra) => regra.type === 'meta_em_risco')!;
      await regras.atualizar(tenant.id, meta.id, {
        enabled: true,
        params: { percentualMinimo: 90, diaDoMes },
      });
    }

    it('dispara para a filial cuja projeção fica abaixo do mínimo', async () => {
      await criarFilial(1, 'Centro');
      await criarFilial(2, 'Zona Sul');
      await lancarMeta({ filialErpId: 1, meta: 30_000, comCurva: true });
      await lancarMeta({ filialErpId: 2, meta: 30_000, comCurva: true });
      await venderNoMes(1, 1_000); // ritmo ~100%
      await venderNoMes(2, 500); // ritmo ~50%

      await ligarRegra(1);
      const resultado = await engine.avaliar(tenant.id);

      expect(resultado.eventosNovos).toBeGreaterThanOrEqual(1);

      const eventos = await tenantDb.run(tenant.id, (tx) =>
        tx.alertEvent.findMany({ include: { rule: { select: { type: true } } } }),
      );
      const daMeta = eventos.filter((evento) => evento.rule.type === 'meta_em_risco');

      expect(daMeta).toHaveLength(1);
      expect(daMeta[0]!.filialErpId).toBe(2);
      expect((daMeta[0]!.payload as { resumo: string }).resumo).toContain('Zona Sul');
    });

    it('não dispara antes do dia configurado — no começo do mês toda loja está atrás', async () => {
      await criarFilial(2, 'Zona Sul');
      await lancarMeta({ filialErpId: 2, meta: 30_000, comCurva: true });
      await venderNoMes(2, 100);

      // Dia 31 como gatilho: em qualquer dia do mês (menos o 31) a regra tem de ficar quieta.
      await ligarRegra(31);
      const resultado = await engine.avaliar(tenant.id);

      const eventos = await tenantDb.run(tenant.id, (tx) =>
        tx.alertEvent.findMany({ include: { rule: { select: { type: true } } } }),
      );

      const daMeta = eventos.filter((evento) => evento.rule.type === 'meta_em_risco');
      const ehDia31 = hoje().endsWith('-31');
      expect(daMeta).toHaveLength(ehDia31 ? 1 : 0);
      expect(resultado.eventosNovos).toBeGreaterThanOrEqual(0);
    });

    it('o mesmo mês em risco não vira alerta todo dia', async () => {
      await criarFilial(2, 'Zona Sul');
      await lancarMeta({ filialErpId: 2, meta: 30_000, comCurva: true });
      await venderNoMes(2, 300);

      await ligarRegra(1);
      const primeira = await engine.avaliar(tenant.id);
      const segunda = await engine.avaliar(tenant.id);

      // A chave de dedupe carrega a competência, não o dia: quinze e-mails sobre a mesma meta
      // seriam quinze motivos para o cliente desligar o alerta.
      expect(primeira.eventosNovos).toBe(1);
      expect(segunda.eventosNovos).toBe(0);
    });
  });
});
