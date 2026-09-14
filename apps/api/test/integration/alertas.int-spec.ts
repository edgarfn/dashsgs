import { API_PREFIX } from '@dashsgs/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../../src/app.module';
import { correlationMiddleware } from '../../src/common/correlation/correlation.middleware';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenantDatabase } from '../../src/common/tenant';
import { AlertEngine } from '../../src/modules/alertas/alert-engine.service';
import { AlertRulesService } from '../../src/modules/alertas/alert-rules.service';
import { agentFor, clearRateLimits, loginWith } from './helpers/auth.helpers';
import {
  cleanupTenantFixtures,
  createTenantFixture,
  type TenantFixture,
} from './helpers/tenant.helpers';

const SENHA = 'Cavalo-Bateria-Grampo-Correto-9';

/**
 * Motor de alertas (épico E8) sobre o espelho real.
 *
 * O que estes cenários protegem é a promessa do M2 do roadmap: **o produto liga para o cliente**.
 * Por isso quase todos terminam conferindo duas coisas — que o alerta certo nasceu, e que ele
 * **não nasce de novo** enquanto o mesmo problema durar (dedupe do doc 15 §8).
 */
describe('alertas (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantDb: TenantDatabase;
  let engine: AlertEngine;
  let regras: AlertRulesService;

  let tenant: TenantFixture;
  let dono: TestAgent;
  let gerente: TestAgent;
  let consulta: TestAgent;
  let csrf: string;
  let csrfGerente: string;

  const hoje = () => new Date().toISOString().slice(0, 10);
  const diasAtras = (dias: number) =>
    new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.use(correlationMiddleware);
    app.use(cookieParser());
    app.setGlobalPrefix(API_PREFIX, { exclude: ['healthz', 'readyz', 'metrics'] });
    await app.init();

    prisma = app.get(PrismaService);
    tenantDb = app.get(TenantDatabase);
    engine = app.get(AlertEngine);
    regras = app.get(AlertRulesService);

    await clearRateLimits(app);

    tenant = await createTenantFixture(app, {
      password: SENHA,
      filiais: [1, 2],
      users: [
        { chave: 'dono', role: 'owner' },
        { chave: 'gerente', role: 'manager' },
        { chave: 'consulta', role: 'viewer' },
      ],
    });

    dono = agentFor(app);
    csrf = (await loginWith(dono, tenant.users.dono!.email, SENHA, { enrollMfa: true })).csrf;

    gerente = agentFor(app);
    csrfGerente = (await loginWith(gerente, tenant.users.gerente!.email, SENHA)).csrf;

    consulta = agentFor(app);
    await loginWith(consulta, tenant.users.consulta!.email, SENHA);
  });

  beforeEach(async () => {
    await clearRateLimits(app);
    await tenantDb.run(tenant.id, async (tx) => {
      await tx.notification.deleteMany({});
      await tx.alertEvent.deleteMany({});
      // As regras também: um cenário que ajusta limiar não pode mudar o resultado do próximo.
      // Elas voltam com os padrões do doc 15 §8 na primeira leitura.
      await tx.alertRule.deleteMany({});
      await tx.erpProduto.deleteMany({});
      await tx.erpFilialVendaResumo.deleteMany({});
      await tx.erpVendaCupom.deleteMany({});
      await tx.syncWatermark.deleteMany({});
    });
  });

  afterAll(async () => {
    await cleanupTenantFixtures(prisma);
    await app?.close();
  });

  /** Produto sintético: os avaliadores de estoque leem exatamente estas colunas. */
  const criarProduto = (dados: {
    erpId: number;
    filialErpId?: number;
    curvaAbc?: string;
    estoqueAtual: number;
    estoqueMinimo?: number;
  }) =>
    tenantDb.run(tenant.id, (tx) =>
      tx.erpProduto.create({
        data: {
          tenantId: tenant.id,
          filialErpId: dados.filialErpId ?? 1,
          erpId: dados.erpId,
          descricao: `PRODUTO ${dados.erpId}`,
          ativo: true,
          curvaAbc: dados.curvaAbc ?? 'A',
          estoqueAtual: dados.estoqueAtual,
          estoqueMinimo: dados.estoqueMinimo ?? 10,
        },
      }),
    );

  const eventos = () =>
    tenantDb.run(tenant.id, (tx) =>
      tx.alertEvent.findMany({ include: { rule: { select: { type: true } } } }),
    );

  // ------------------------------------------------------------------ regras padrão
  describe('regras padrão (E8-03)', () => {
    it('semeia o catálogo do doc 15 §8 na primeira consulta', async () => {
      const lista = await regras.listar(tenant.id);

      expect(lista.length).toBeGreaterThanOrEqual(10);
      expect(lista.map((regra) => regra.type)).toContain('ruptura_curva_a');

      // Regra sem avaliador nasce desligada: ligar algo que não roda seria promessa falsa.
      const semDado = lista.find((regra) => regra.type === 'conta_a_vencer');
      expect(semDado?.enabled).toBe(false);
      expect(semDado?.dependencia).toContain('financeira');
    });

    it('semear de novo não duplica nem sobrescreve o ajuste do cliente', async () => {
      const lista = await regras.listar(tenant.id);
      const ruptura = lista.find((regra) => regra.type === 'ruptura_curva_a')!;

      await regras.atualizar(tenant.id, ruptura.id, { params: { minimoDeItens: 25 } });
      await regras.semearPadroes(tenant.id);

      const depois = await regras.listar(tenant.id);
      expect(depois).toHaveLength(lista.length);
      expect(depois.find((regra) => regra.type === 'ruptura_curva_a')?.params.minimoDeItens).toBe(
        25,
      );
    });

    it('recusa parâmetro que a regra não conhece', async () => {
      const lista = await regras.listar(tenant.id);
      const ruptura = lista.find((regra) => regra.type === 'ruptura_curva_a')!;

      await expect(
        regras.atualizar(tenant.id, ruptura.id, { params: { inventado: 3 } }),
      ).rejects.toThrow('desconhecido');
    });
  });

  // ------------------------------------------------------------------ avaliação
  describe('avaliação (E8-01)', () => {
    it('agrupa a ruptura de curva A por filial, em vez de um alerta por item', async () => {
      for (const erpId of [101, 102, 103]) {
        await criarProduto({ erpId, estoqueAtual: 1, estoqueMinimo: 10 });
      }
      await criarProduto({ erpId: 201, filialErpId: 2, estoqueAtual: 0, estoqueMinimo: 5 });

      const resultado = await engine.avaliar(tenant.id);

      expect(resultado.eventosNovos).toBe(2);
      const criados = (await eventos()).filter((evento) => evento.rule.type === 'ruptura_curva_a');
      expect(criados).toHaveLength(2);

      const daFilial1 = criados.find((evento) => evento.filialErpId === 1);
      expect((daFilial1?.payload as { itens: number }).itens).toBe(3);
      expect((daFilial1?.payload as { resumo: string }).resumo).toContain('3 itens');
    });

    it('o mesmo problema não vira alerta duas vezes no mesmo dia', async () => {
      await criarProduto({ erpId: 101, estoqueAtual: 1 });

      const primeira = await engine.avaliar(tenant.id);
      const segunda = await engine.avaliar(tenant.id);

      expect(primeira.eventosNovos).toBe(1);
      expect(segunda.eventosNovos).toBe(0);
      // A ocorrência continua sendo detectada — o que não se repete é o aviso.
      expect(segunda.ocorrencias).toBe(1);
      expect(await eventos()).toHaveLength(1);
    });

    it('produto de curva C em falta não acorda ninguém', async () => {
      await criarProduto({ erpId: 301, curvaAbc: 'C', estoqueAtual: 1 });

      const resultado = await engine.avaliar(tenant.id);
      const ruptura = (await eventos()).filter((evento) => evento.rule.type === 'ruptura_curva_a');

      expect(ruptura).toHaveLength(0);
      expect(resultado.eventosNovos).toBe(0);
    });

    it('estoque negativo é alerta próprio, com severidade menor', async () => {
      await criarProduto({ erpId: 401, curvaAbc: 'B', estoqueAtual: -5, estoqueMinimo: 0 });

      await engine.avaliar(tenant.id);
      const negativo = (await eventos()).find((evento) => evento.rule.type === 'estoque_negativo');

      expect(negativo).toBeDefined();
      expect(negativo?.severity).toBe('media');
    });

    it('divergência apontada pelo ERP vira alerta do dia anterior', async () => {
      await tenantDb.run(tenant.id, (tx) =>
        tx.erpFilialVendaResumo.create({
          data: {
            tenantId: tenant.id,
            filialErpId: 1,
            data: new Date(`${diasAtras(1)}T00:00:00Z`),
            valor: 1000,
            gerouVendasDiaria: true,
            possuiDivergencia: true,
          },
        }),
      );

      await engine.avaliar(tenant.id);
      const evento = (await eventos()).find((item) => item.rule.type === 'divergencia_fechamento');

      expect(evento).toBeDefined();
      expect(evento?.dedupeKey).toBe(`${diasAtras(1)}:1`);
      expect((evento?.payload as { resumo: string }).resumo).toContain('divergência');
    });

    it('queda de venda só dispara depois da hora de corte', async () => {
      // Histórico forte nas quatro semanas anteriores, venda fraca hoje.
      for (const dias of [7, 14, 21, 28]) {
        await tenantDb.run(tenant.id, (tx) =>
          tx.erpFilialVendaResumo.create({
            data: {
              tenantId: tenant.id,
              filialErpId: 1,
              data: new Date(`${diasAtras(dias)}T00:00:00Z`),
              valor: 10_000,
              gerouVendasDiaria: true,
            },
          }),
        );
      }
      await tenantDb.run(tenant.id, (tx) =>
        tx.erpVendaCupom.create({
          data: {
            tenantId: tenant.id,
            filialErpId: 1,
            data: new Date(`${hoje()}T00:00:00Z`),
            caixa: 1,
            cupom: 1,
            valorTotal: 1_000,
          },
        }),
      );

      const lista = await regras.listar(tenant.id);
      const queda = lista.find((regra) => regra.type === 'queda_de_venda')!;

      // Antes da hora de corte, a regra fica quieta: toda loja está "abaixo da média" às 9h.
      await regras.atualizar(tenant.id, queda.id, { params: { horaDeCorte: 23 } });
      await engine.avaliar(tenant.id);
      expect((await eventos()).some((evento) => evento.rule.type === 'queda_de_venda')).toBe(false);

      await regras.atualizar(tenant.id, queda.id, { params: { horaDeCorte: 0 } });
      await engine.avaliar(tenant.id);

      const evento = (await eventos()).find((item) => item.rule.type === 'queda_de_venda');
      expect(evento).toBeDefined();
      expect((evento?.payload as { percentual: number }).percentual).toBeCloseTo(10, 0);
    });

    it('regra desligada não avalia nada', async () => {
      await criarProduto({ erpId: 101, estoqueAtual: 1 });

      const lista = await regras.listar(tenant.id);
      const ruptura = lista.find((regra) => regra.type === 'ruptura_curva_a')!;
      await regras.atualizar(tenant.id, ruptura.id, { enabled: false });

      await engine.avaliar(tenant.id);
      expect(await eventos()).toHaveLength(0);

      await regras.atualizar(tenant.id, ruptura.id, { enabled: true });
    });
  });

  // ------------------------------------------------------------------ integração parada
  describe('integração parada (E8-05)', () => {
    it('avisa quando a conexão com o ERP está em erro', async () => {
      await tenantDb.run(tenant.id, (tx) =>
        tx.erpConnection.create({
          data: {
            tenantId: tenant.id,
            baseUrl: 'http://example.com:8201',
            username: 'integracao',
            secretCiphertext: Buffer.from('cifra-sintetica'),
            secretKeyVersion: 1,
            status: 'error',
            lastError: 'credenciais_invalidas',
          },
        }),
      );

      await engine.avaliar(tenant.id);
      const evento = (await eventos()).find((item) => item.rule.type === 'integracao_parada');

      expect(evento).toBeDefined();
      expect(evento?.severity).toBe('critica');
      // Este alerta é da rede inteira, não de uma filial.
      expect(evento?.filialErpId).toBeNull();

      await tenantDb.run(tenant.id, (tx) => tx.erpConnection.deleteMany({}));
    });

    it('o motor roda mesmo sem conexão configurada — é o caso em que ele mais importa', async () => {
      await criarProduto({ erpId: 101, estoqueAtual: 1 });

      const resultado = await engine.avaliar(tenant.id);

      expect(resultado.eventosNovos).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------ notificação
  describe('notificação (E8-02)', () => {
    it('registra a entrega por destinatário, com o papel certo', async () => {
      await criarProduto({ erpId: 101, estoqueAtual: 1 });
      await engine.avaliar(tenant.id);

      const notificacoes = await tenantDb.run(tenant.id, (tx) =>
        tx.notification.findMany({ select: { userId: true, status: true, channel: true } }),
      );

      // Ruptura é aviso de operação: owner e manager recebem; o viewer, não.
      expect(notificacoes).toHaveLength(2);
      expect(notificacoes.every((item) => item.channel === 'email')).toBe(true);
      expect(notificacoes.every((item) => item.status === 'sent')).toBe(true);

      const destinatarios = notificacoes.map((item) => item.userId);
      expect(destinatarios).toContain(tenant.users.dono!.id);
      expect(destinatarios).toContain(tenant.users.gerente!.id);
      expect(destinatarios).not.toContain(tenant.users.consulta!.id);
    });

    it('alerta com canal de e-mail desligado fica só no feed', async () => {
      const lista = await regras.listar(tenant.id);
      const ruptura = lista.find((regra) => regra.type === 'ruptura_curva_a')!;
      await regras.atualizar(tenant.id, ruptura.id, { canalEmail: false });

      await criarProduto({ erpId: 101, estoqueAtual: 1 });
      await engine.avaliar(tenant.id);

      expect(await eventos()).toHaveLength(1);
      expect(await tenantDb.run(tenant.id, (tx) => tx.notification.count())).toBe(0);

      await regras.atualizar(tenant.id, ruptura.id, { canalEmail: true });
    });
  });

  // ------------------------------------------------------------------ feed
  describe('feed e permissões (E8-02/E8-04)', () => {
    it('lista os abertos ordenados por severidade', async () => {
      await criarProduto({ erpId: 101, estoqueAtual: 1 });
      await criarProduto({ erpId: 401, curvaAbc: 'B', estoqueAtual: -2, estoqueMinimo: 0 });
      await engine.avaliar(tenant.id);

      const { body } = await gerente.get(`${API_PREFIX}/alertas`).expect(200);

      expect(body.eventos.length).toBeGreaterThanOrEqual(2);
      expect(body.contagens.abertos).toBe(body.eventos.length);
      // Alta (ruptura) antes de média (estoque negativo).
      expect(body.eventos[0].severidade).toBe('alta');
    });

    it('reconhecer marca quem assumiu e some do filtro de abertos', async () => {
      await criarProduto({ erpId: 101, estoqueAtual: 1 });
      await engine.avaliar(tenant.id);

      const feed = await gerente.get(`${API_PREFIX}/alertas`).expect(200);
      const evento = feed.body.eventos[0];

      const reconhecido = await gerente
        .post(`${API_PREFIX}/alertas/${evento.id}/reconhecer`)
        .set('x-csrf-token', csrfGerente)
        .expect(200);

      expect(reconhecido.body.status).toBe('acknowledged');
      expect(reconhecido.body.reconhecidoPor).toBe(tenant.users.gerente!.id);

      const abertos = await gerente.get(`${API_PREFIX}/alertas?status=open`).expect(200);
      expect(abertos.body.eventos).toHaveLength(0);
    });

    it('reconhecer duas vezes não é erro — dois gerentes clicam juntos', async () => {
      await criarProduto({ erpId: 101, estoqueAtual: 1 });
      await engine.avaliar(tenant.id);

      const feed = await gerente.get(`${API_PREFIX}/alertas`).expect(200);
      const id = feed.body.eventos[0].id;

      await gerente
        .post(`${API_PREFIX}/alertas/${id}/reconhecer`)
        .set('x-csrf-token', csrfGerente)
        .expect(200);
      await dono
        .post(`${API_PREFIX}/alertas/${id}/reconhecer`)
        .set('x-csrf-token', csrf)
        .expect(200);
    });

    it('quem só consulta não vê o feed nem configura regra', async () => {
      await consulta.get(`${API_PREFIX}/alertas`).expect(403);
      await consulta.get(`${API_PREFIX}/alertas/regras`).expect(403);
    });

    it('gerente ajusta o limiar da própria operação (matriz do doc 07 §3)', async () => {
      const lista = await dono.get(`${API_PREFIX}/alertas/regras`).expect(200);
      const ruptura = lista.body.find(
        (regra: { type: string }) => regra.type === 'ruptura_curva_a',
      );

      // `alerts.manage` é de owner, admin **e** manager: quem opera a loja calibra o próprio
      // aviso sem depender do administrador do contrato.
      const ajustada = await gerente
        .patch(`${API_PREFIX}/alertas/regras/${ruptura.id}`)
        .set('x-csrf-token', csrfGerente)
        .send({ params: { minimoDeItens: 5 } })
        .expect(200);

      expect(ajustada.body.params.minimoDeItens).toBe(5);
    });

    it('alerta de outro tenant simplesmente não existe daqui', async () => {
      const vizinho = await createTenantFixture(app, {
        password: SENHA,
        filiais: [1],
        users: [{ chave: 'dono', role: 'owner' }],
      });

      await tenantDb.run(vizinho.id, (tx) =>
        tx.erpProduto.create({
          data: {
            tenantId: vizinho.id,
            filialErpId: 1,
            erpId: 999,
            descricao: 'PRODUTO DO VIZINHO',
            ativo: true,
            curvaAbc: 'A',
            estoqueAtual: 0,
            estoqueMinimo: 10,
          },
        }),
      );
      await engine.avaliar(vizinho.id);

      const doVizinho = await tenantDb.run(vizinho.id, (tx) => tx.alertEvent.findMany());
      expect(doVizinho.length).toBeGreaterThan(0);

      const feed = await gerente.get(`${API_PREFIX}/alertas`).expect(200);
      expect(feed.body.eventos).toHaveLength(0);

      await dono
        .post(`${API_PREFIX}/alertas/${doVizinho[0]!.id}/reconhecer`)
        .set('x-csrf-token', csrf)
        .expect(404);
    });
  });
});
