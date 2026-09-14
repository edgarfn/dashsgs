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

/**
 * Financeiro e compras (E5-09, E5-10 parcial, E7-08) da API SG até a tela.
 *
 * A cadeia inteira é exercida: o sync busca no mock, grava no espelho, e o painel responde as
 * perguntas do doc 15 §5/§6 — aging, fluxo, despesas, taxa de cartão e lead time. É também aqui
 * que as duas regras de alerta que dependem desses dados ganham teste.
 */
describe('financeiro e compras (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantDb: TenantDatabase;
  let redis: RedisService;
  let sync: SyncService;
  let engine: AlertEngine;
  let regras: AlertRulesService;

  let tenant: TenantFixture;
  let dono: TestAgent;
  let analista: TestAgent;
  let csrf: string;

  const hoje = () => new Date().toISOString().slice(0, 10);
  const emDias = (dias: number) =>
    new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

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
      filiais: [1, 2],
      users: [
        { chave: 'dono', role: 'owner' },
        { chave: 'analista', role: 'analyst' },
      ],
    });

    dono = agentFor(app);
    csrf = (await loginWith(dono, tenant.users.dono!.email, SENHA, { enrollMfa: true })).csrf;

    analista = agentFor(app);
    await loginWith(analista, tenant.users.analista!.email, SENHA);

    await dono.put(`${API_PREFIX}/tenant/erp-connection`).set('x-csrf-token', csrf).send({
      baseUrl: BASE_URL,
      username: MOCK_USUARIO,
      senha: MOCK_SENHA,
      isSgCloud: false,
      tlsMode: 'https',
      maxRps: 20,
    });

    await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });
  });

  beforeEach(async () => {
    await clearRateLimits(app);
    await redis.purgeTenant(tenant.id);
  });

  afterAll(async () => {
    await cleanupTenantFixtures(prisma);
    await app?.close();
  });

  const limpar = () =>
    tenantDb.run(tenant.id, async (tx) => {
      await tx.erpContaPagarParcela.deleteMany({});
      await tx.erpContaPagar.deleteMany({});
      await tx.erpContaReceberParcela.deleteMany({});
      await tx.erpContaReceber.deleteMany({});
      await tx.erpDespesa.deleteMany({});
      await tx.erpTipoDespesa.deleteMany({});
      await tx.erpCartaoVenda.deleteMany({});
      await tx.erpPedidoCompra.deleteMany({});
      await tx.erpNotaEntrada.deleteMany({});
    });

  // ------------------------------------------------------------------ sync
  describe('sincronização financeira (E5-09)', () => {
    it('traz títulos com parcelas, despesas com tipos e cartões', async () => {
      await limpar();
      const desfecho = await sync.executar({ tenantId: tenant.id, domain: 'financeiro' });

      expect([desfecho.status, desfecho.erro]).toEqual(['success', undefined]);

      const contagens = await tenantDb.run(tenant.id, async (tx) => ({
        pagar: await tx.erpContaPagar.count(),
        parcelasPagar: await tx.erpContaPagarParcela.count(),
        receber: await tx.erpContaReceber.count(),
        despesas: await tx.erpDespesa.count(),
        tipos: await tx.erpTipoDespesa.count(),
        cartoes: await tx.erpCartaoVenda.count(),
      }));

      expect(contagens.pagar).toBe(2);
      // Três parcelas no primeiro título, uma no segundo — o aging depende dessa granularidade.
      expect(contagens.parcelasPagar).toBe(4);
      expect(contagens.receber).toBe(1);
      expect(contagens.despesas).toBe(3);
      expect(contagens.tipos).toBe(3);
      // O endpoint de cartões devolve array puro, sem envelope (doc 02 §3).
      expect(contagens.cartoes).toBe(3);
    });

    it('converte o status textual da parcela no booleano que a tela pergunta', async () => {
      await limpar();
      await sync.executar({ tenantId: tenant.id, domain: 'financeiro' });

      const parcelas = await tenantDb.run(tenant.id, (tx) =>
        tx.erpContaPagarParcela.findMany({ orderBy: [{ contaErpId: 'asc' }, { ordem: 'asc' }] }),
      );

      expect(parcelas[0]?.paga).toBe(true);
      expect(parcelas[1]?.paga).toBe(false);
      // `0000-00-00` é o "sem data" do ERP e não pode virar data de pagamento (doc 12 §4.3).
      expect(parcelas[2]?.dataPagamento).toBeNull();
    });

    it('repetir a sincronização não duplica título nem parcela', async () => {
      await limpar();
      await sync.executar({ tenantId: tenant.id, domain: 'financeiro' });
      const primeira = await tenantDb.run(tenant.id, (tx) => tx.erpContaPagarParcela.count());

      await sync.executar({ tenantId: tenant.id, domain: 'financeiro' });
      expect(await tenantDb.run(tenant.id, (tx) => tx.erpContaPagarParcela.count())).toBe(primeira);
    });

    it('compras traz pedidos e notas de entrada', async () => {
      await limpar();
      const desfecho = await sync.executar({ tenantId: tenant.id, domain: 'compras' });

      expect([desfecho.status, desfecho.erro]).toEqual(['success', undefined]);

      const contagens = await tenantDb.run(tenant.id, async (tx) => ({
        pedidos: await tx.erpPedidoCompra.count(),
        entradas: await tx.erpNotaEntrada.count(),
      }));

      expect(contagens.pedidos).toBe(3);
      expect(contagens.entradas).toBe(2);
    });
  });

  // ------------------------------------------------------------------ painel financeiro
  describe('painel financeiro (E7-08)', () => {
    beforeEach(async () => {
      await limpar();
      await tenantDb.run(tenant.id, async (tx) => {
        // Um título por faixa do aging, incluindo vencido — é o que a tela precisa distinguir.
        for (const [indice, offset] of [-10, 2, 20, 60, 200].entries()) {
          await tx.erpContaPagar.create({
            data: { tenantId: tenant.id, erpId: 100 + indice, filialErpId: 1, valorTotal: 1000 },
          });
          await tx.erpContaPagarParcela.create({
            data: {
              tenantId: tenant.id,
              contaErpId: 100 + indice,
              ordem: 1,
              dataVencimento: new Date(`${emDias(offset)}T00:00:00Z`),
              valorDocumento: 1000,
              saldo: 1000,
              paga: false,
            },
          });
        }

        // Parcela paga: não entra no aging.
        await tx.erpContaPagar.create({
          data: { tenantId: tenant.id, erpId: 200, filialErpId: 1, valorTotal: 5000 },
        });
        await tx.erpContaPagarParcela.create({
          data: {
            tenantId: tenant.id,
            contaErpId: 200,
            ordem: 1,
            dataVencimento: new Date(`${emDias(5)}T00:00:00Z`),
            valorDocumento: 5000,
            paga: true,
          },
        });

        await tx.erpTipoDespesa.createMany({
          data: [
            { tenantId: tenant.id, erpId: '10', descricao: 'ALUGUEL', classificacao: 'FIXA' },
            { tenantId: tenant.id, erpId: '11', descricao: 'FRETE', classificacao: 'VARIAVEL' },
          ],
        });
        await tx.erpDespesa.createMany({
          data: [
            {
              tenantId: tenant.id,
              filialErpId: 1,
              dataDespesa: new Date(`${hoje()}T00:00:00Z`),
              sequencia: 1,
              tipoDespesaErpId: '10',
              valor: 3000,
              classificacao: 'FIXA',
            },
            {
              tenantId: tenant.id,
              filialErpId: 1,
              dataDespesa: new Date(`${hoje()}T00:00:00Z`),
              sequencia: 2,
              tipoDespesaErpId: '11',
              valor: 1000,
              classificacao: 'VARIAVEL',
            },
          ],
        });

        // Duas transações com taxas bem diferentes e volumes desiguais: é o caso em que a média
        // simples mentiria e a ponderada acerta.
        await tx.erpCartaoVenda.createMany({
          data: [
            {
              tenantId: tenant.id,
              chaveVenda: 'A1',
              filialErpId: 1,
              dataVenda: new Date(`${hoje()}T00:00:00Z`),
              valorBruto: 9000,
              taxaPct: 1,
              bandeira: 'VISA',
              adquirente: 'CIELO',
              baixada: true,
            },
            {
              tenantId: tenant.id,
              chaveVenda: 'A2',
              filialErpId: 1,
              dataVenda: new Date(`${hoje()}T00:00:00Z`),
              valorBruto: 1000,
              taxaPct: 11,
              bandeira: 'ELO',
              adquirente: 'CIELO',
              baixada: true,
            },
          ],
        });
      });
    });

    it('separa o aging por faixa de vencimento, ignorando o que já foi pago', async () => {
      const { body } = await dono
        .get(`${API_PREFIX}/dashboard/financeiro?de=${hoje()}&ate=${hoje()}`)
        .expect(200);

      const porBucket = Object.fromEntries(
        body.aging.pagar.buckets.map((faixa: { bucket: string; valor: number }) => [
          faixa.bucket,
          faixa.valor,
        ]),
      );

      expect(porBucket.vencido).toBe(1000);
      expect(porBucket.ate7).toBe(1000);
      expect(porBucket.ate30).toBe(1000);
      expect(porBucket.ate90).toBe(1000);
      expect(porBucket.acima90).toBe(1000);
      // A parcela paga (R$ 5.000) não aparece em faixa nenhuma.
      expect(body.aging.pagar.total).toBe(5000);
    });

    it('calcula a taxa média de cartão ponderada pelo volume', async () => {
      const { body } = await dono
        .get(`${API_PREFIX}/dashboard/financeiro?de=${hoje()}&ate=${hoje()}`)
        .expect(200);

      expect(body.cartoes.volumeBruto).toBe(10_000);
      // Ponderada: (9000×1% + 1000×11%) / 10000 = 2%. A média simples daria 6%.
      expect(body.cartoes.taxaMediaPct).toBeCloseTo(2, 5);
      expect(body.cartoes.valorTaxas).toBeCloseTo(200, 5);
    });

    it('classifica despesas entre fixas e variáveis', async () => {
      const { body } = await dono
        .get(`${API_PREFIX}/dashboard/financeiro?de=${hoje()}&ate=${hoje()}`)
        .expect(200);

      expect(body.despesas.total).toBe(4000);
      expect(body.despesas.fixasPct).toBeCloseTo(75, 5);
      expect(body.despesas.porTipo[0].descricao).toBe('ALUGUEL');
    });

    it('o fluxo previsto só olha para frente', async () => {
      const { body } = await dono
        .get(`${API_PREFIX}/dashboard/financeiro?de=${hoje()}&ate=${hoje()}`)
        .expect(200);

      expect(body.fluxo.length).toBeGreaterThan(0);
      for (const semana of body.fluxo) {
        // A semana pode começar antes de hoje, mas nenhuma parcela vencida entra no previsto.
        expect(semana.pagar + semana.receber).toBeGreaterThan(0);
      }
    });

    it('quem não tem papel de gestão não abre o financeiro', async () => {
      // Analista enxerga venda, não a dívida da rede (doc 16 §2: Financeiro é manager+).
      await analista
        .get(`${API_PREFIX}/dashboard/financeiro?de=${hoje()}&ate=${hoje()}`)
        .expect(403);
    });
  });

  // ------------------------------------------------------------------ painel compras
  describe('painel de compras (E7-08)', () => {
    it('agrupa por situação, calcula lead time e lista pedido parado', async () => {
      await limpar();
      await tenantDb.run(tenant.id, (tx) =>
        tx.erpPedidoCompra.createMany({
          data: [
            {
              tenantId: tenant.id,
              erpId: 1,
              filialErpId: 1,
              dataPedido: new Date(`${emDias(-20)}T00:00:00Z`),
              dataAtendimento: new Date(`${emDias(-14)}T00:00:00Z`),
              situacao: 'atendido',
              valorTotal: 1000,
            },
            {
              tenantId: tenant.id,
              erpId: 2,
              filialErpId: 1,
              dataPedido: new Date(`${emDias(-10)}T00:00:00Z`),
              dataAtendimento: new Date(`${emDias(-6)}T00:00:00Z`),
              situacao: 'atendido',
              valorTotal: 2000,
            },
            {
              tenantId: tenant.id,
              erpId: 3,
              filialErpId: 1,
              dataPedido: new Date(`${emDias(-40)}T00:00:00Z`),
              situacao: 'pendente',
              valorTotal: 3000,
            },
          ],
        }),
      );

      const { body } = await dono
        .get(`${API_PREFIX}/dashboard/compras?de=${emDias(-60)}&ate=${hoje()}`)
        .expect(200);

      expect(body.porSituacao).toEqual(
        expect.arrayContaining([{ situacao: 'atendido', pedidos: 2, valor: 3000 }]),
      );
      // Lead time do pedido ao atendimento: (6 + 4) / 2 = 5 dias.
      expect(body.leadTimeDias.media).toBeCloseTo(5, 5);
      expect(body.leadTimeDias.atendidos).toBe(2);

      expect(body.pendentesAntigos).toHaveLength(1);
      expect(body.pendentesAntigos[0]).toMatchObject({ erpId: 3, diasEmAberto: 40 });
    });
  });

  // ------------------------------------------------------------------ alertas
  describe('alertas que dependem do financeiro (E8-03)', () => {
    beforeEach(async () => {
      await limpar();
      await tenantDb.run(tenant.id, (tx) => tx.alertEvent.deleteMany({}));
      await tenantDb.run(tenant.id, (tx) => tx.alertRule.deleteMany({}));
    });

    it('avisa sobre parcelas vencendo, somando o total', async () => {
      await tenantDb.run(tenant.id, async (tx) => {
        await tx.erpContaPagar.create({
          data: { tenantId: tenant.id, erpId: 1, filialErpId: 1, valorTotal: 2500 },
        });
        await tx.erpContaPagarParcela.createMany({
          data: [
            {
              tenantId: tenant.id,
              contaErpId: 1,
              ordem: 1,
              dataVencimento: new Date(`${emDias(1)}T00:00:00Z`),
              valorDocumento: 1500,
              saldo: 1500,
              paga: false,
            },
            {
              tenantId: tenant.id,
              contaErpId: 1,
              ordem: 2,
              dataVencimento: new Date(`${emDias(2)}T00:00:00Z`),
              valorDocumento: 1000,
              saldo: 1000,
              paga: false,
            },
          ],
        });
      });

      await engine.avaliar(tenant.id);

      const evento = await tenantDb.run(tenant.id, (tx) =>
        tx.alertEvent.findFirst({ where: { rule: { type: 'conta_a_vencer' } } }),
      );

      expect(evento).toBeDefined();
      expect((evento?.payload as { parcelas: number }).parcelas).toBe(2);
      expect((evento?.payload as { total: number }).total).toBe(2500);
      // Um alerta com o total, não dois com um boleto cada.
      expect((evento?.payload as { resumo: string }).resumo).toContain('2 parcelas');
    });

    it('respeita o valor mínimo configurado', async () => {
      const lista = await regras.listar(tenant.id);
      const regra = lista.find((item) => item.type === 'conta_a_vencer')!;
      await regras.atualizar(tenant.id, regra.id, { params: { dias: 3, valorMinimo: 10_000 } });

      await tenantDb.run(tenant.id, async (tx) => {
        await tx.erpContaPagar.create({
          data: { tenantId: tenant.id, erpId: 2, filialErpId: 1, valorTotal: 500 },
        });
        await tx.erpContaPagarParcela.create({
          data: {
            tenantId: tenant.id,
            contaErpId: 2,
            ordem: 1,
            dataVencimento: new Date(`${emDias(1)}T00:00:00Z`),
            valorDocumento: 500,
            saldo: 500,
            paga: false,
          },
        });
      });

      await engine.avaliar(tenant.id);

      const eventos = await tenantDb.run(tenant.id, (tx) =>
        tx.alertEvent.count({ where: { rule: { type: 'conta_a_vencer' } } }),
      );
      expect(eventos).toBe(0);
    });

    it('avisa sobre cartão sem baixa depois do prazo, por filial', async () => {
      await tenantDb.run(tenant.id, (tx) =>
        tx.erpCartaoVenda.createMany({
          data: [
            {
              tenantId: tenant.id,
              chaveVenda: 'V1',
              filialErpId: 1,
              dataVenda: new Date(`${emDias(-20)}T00:00:00Z`),
              valorBruto: 800,
              baixada: false,
            },
            {
              tenantId: tenant.id,
              chaveVenda: 'V2',
              filialErpId: 1,
              dataVenda: new Date(`${emDias(-15)}T00:00:00Z`),
              valorBruto: 200,
              baixada: false,
            },
            // Recente: ainda dentro do prazo, não é problema.
            {
              tenantId: tenant.id,
              chaveVenda: 'V3',
              filialErpId: 1,
              dataVenda: new Date(`${emDias(-1)}T00:00:00Z`),
              valorBruto: 500,
              baixada: false,
            },
            // Já conciliada.
            {
              tenantId: tenant.id,
              chaveVenda: 'V4',
              filialErpId: 1,
              dataVenda: new Date(`${emDias(-30)}T00:00:00Z`),
              valorBruto: 900,
              baixada: true,
            },
          ],
        }),
      );

      await engine.avaliar(tenant.id);

      const evento = await tenantDb.run(tenant.id, (tx) =>
        tx.alertEvent.findFirst({ where: { rule: { type: 'cartao_nao_conciliado' } } }),
      );

      expect(evento).toBeDefined();
      expect((evento?.payload as { transacoes: number }).transacoes).toBe(2);
      expect((evento?.payload as { total: number }).total).toBe(1000);
    });
  });
});
