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
import { BackfillService } from '../../src/modules/sync/backfill.service';
import { SyncLockService } from '../../src/modules/sync/sync-lock.service';
import { SyncRunService } from '../../src/modules/sync/sync-run.service';
import { SyncService } from '../../src/modules/sync/sync.service';
import { SyncStatusService } from '../../src/modules/sync/sync-status.service';
import { WatermarkService } from '../../src/modules/sync/watermark.service';
import { somarDias } from '../../src/modules/sync/sync.types';
import { agentFor, clearRateLimits, loginWith } from './helpers/auth.helpers';
import {
  cleanupTenantFixtures,
  createTenantFixture,
  type TenantFixture,
  hojeNoTenant,
} from './helpers/tenant.helpers';

const SENHA = 'Cavalo-Bateria-Grampo-Correto-9';
const BASE_URL = 'http://example.com:8201';

/**
 * Sincronização (épico E5) contra Postgres, Redis e o mock da API SG.
 *
 * O que estes testes protegem é a promessa central do produto: **os números da loja no painel são
 * os números do ERP**. Por isso quase todo cenário termina conferindo linhas gravadas — e
 * repetindo a execução para provar que repetir não duplica (doc 14 §1).
 */
describe('sincronização (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantDb: TenantDatabase;
  let redis: RedisService;
  let sync: SyncService;
  let backfill: BackfillService;
  let watermarks: WatermarkService;
  let status: SyncStatusService;
  let locks: SyncLockService;

  let tenant: TenantFixture;
  let dono: TestAgent;
  let csrf: string;

  const hoje = () => hojeNoTenant();

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
    backfill = app.get(BackfillService);
    watermarks = app.get(WatermarkService);
    status = app.get(SyncStatusService);
    locks = app.get(SyncLockService);

    await clearRateLimits(app);

    tenant = await createTenantFixture(app, {
      password: SENHA,
      filiais: [1],
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
    await limparEspelho();
  });

  afterAll(async () => {
    await cleanupTenantFixtures(prisma);
    await app?.close();
  });

  /** Zera espelho, agregados e estado de sync entre cenários (sem tocar em identidade). */
  async function limparEspelho(): Promise<void> {
    await tenantDb.run(tenant.id, async (tx) => {
      await tx.aggVendasDiaDep.deleteMany({});
      await tx.aggVendasHora.deleteMany({});
      await tx.erpVendaItem.deleteMany({});
      await tx.erpVendaCupom.deleteMany({});
      await tx.erpFinalizadoraLancamento.deleteMany({});
      await tx.erpFilialVendaResumo.deleteMany({});
      await tx.erpProduto.deleteMany({});
      await tx.erpGtin.deleteMany({});
      await tx.erpMarca.deleteMany({});
      await tx.erpDepartamentoN1.deleteMany({});
      await tx.syncWatermark.deleteMany({});
      await tx.syncJobRun.deleteMany({});
      await tx.syncApiCallLog.deleteMany({});
    });

    const chaves = await redis.client.keys(`lock:t:${tenant.id}:sync:*`);
    if (chaves.length > 0) await redis.client.del(...chaves);
  }

  const salvarCredencial = (senha: string) =>
    dono.put(`${API_PREFIX}/tenant/erp-connection`).set('x-csrf-token', csrf).send({
      baseUrl: BASE_URL,
      username: MOCK_USUARIO,
      senha,
      isSgCloud: false,
      tlsMode: 'https',
      maxRps: 20,
    });

  /** Espera o lock aparecer no Redis — evita corrida entre "segurar" e "tentar executar". */
  async function esperarLock(chave: string): Promise<void> {
    for (let tentativa = 0; tentativa < 50; tentativa += 1) {
      if (await redis.client.get(chave)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`lock ${chave} não foi adquirido`);
  }

  const contar = async (tabela: 'cupons' | 'itens' | 'finalizadoras' | 'produtos' | 'resumos') =>
    tenantDb.run(tenant.id, async (tx) => {
      switch (tabela) {
        case 'cupons':
          return tx.erpVendaCupom.count();
        case 'itens':
          return tx.erpVendaItem.count();
        case 'finalizadoras':
          return tx.erpFinalizadoraLancamento.count();
        case 'produtos':
          return tx.erpProduto.count();
        default:
          return tx.erpFilialVendaResumo.count();
      }
    });

  // ------------------------------------------------------------------ dimensões
  describe('dimensões (E5-02)', () => {
    it('grava filiais e as dimensões contratadas, pulando as que o contrato não libera', async () => {
      const desfecho = await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });

      // O motivo entra na asserção: quando quebrar, a mensagem do teste já diz o porquê.
      expect([desfecho.status, desfecho.erro]).toEqual(['success', undefined]);

      const dados = await tenantDb.run(tenant.id, async (tx) => ({
        filiais: await tx.erpFilial.count(),
        marcas: await tx.erpMarca.count(),
        departamentos: await tx.erpDepartamentoN1.count(),
        classes: await tx.erpClasse.count(),
      }));

      expect(dados.filiais).toBeGreaterThan(0);
      expect(dados.marcas).toBeGreaterThan(0);
      expect(dados.departamentos).toBeGreaterThan(0);
      // /classes não está na claim `routes` do mock: degradação graciosa, não erro (doc 12 §2).
      expect(dados.classes).toBe(0);
      expect(desfecho.resultado?.observacao).toContain('fora do contrato');
    });

    it('rodar duas vezes não duplica nem apaga (upsert por chave natural)', async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });
      const depoisDaPrimeira = await tenantDb.run(tenant.id, (tx) => tx.erpMarca.count());

      await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });
      const depoisDaSegunda = await tenantDb.run(tenant.id, (tx) => tx.erpMarca.count());

      expect(depoisDaSegunda).toBe(depoisDaPrimeira);
    });

    it('a descrição vinda do ERP sobrescreve a anterior', async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });

      await tenantDb.run(tenant.id, (tx) =>
        tx.erpMarca.updateMany({ data: { descricao: 'VALOR ANTIGO' } }),
      );
      await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });

      const antigas = await tenantDb.run(tenant.id, (tx) =>
        tx.erpMarca.count({ where: { descricao: 'VALOR ANTIGO' } }),
      );
      expect(antigas).toBe(0);
    });
  });

  // ------------------------------------------------------------------ produtos
  describe('produtos (E5-03)', () => {
    it('varre as três datas de alteração e grava produtos e GTINs', async () => {
      const desfecho = await sync.executar({ tenantId: tenant.id, domain: 'produtos' });

      expect(desfecho.status).toBe('success');
      expect(await contar('produtos')).toBeGreaterThan(0);

      const gtins = await tenantDb.run(tenant.id, (tx) => tx.erpGtin.count());
      // A fixture traz três GTINs, um deles com `idGTIN: false` — que vai para a quarentena.
      expect(gtins).toBe(2);
      expect(desfecho.resultado?.invalid ?? 0).toBeGreaterThan(0);
    });

    it("a segunda varredura usa a marca d'água e não duplica linhas", async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'produtos' });
      const primeira = await contar('produtos');

      const marca = await watermarks.obter(tenant.id, 'produtos');
      expect(marca?.watermarkTs).toBeTruthy();

      await sync.executar({ tenantId: tenant.id, domain: 'produtos' });
      expect(await contar('produtos')).toBe(primeira);
    });
  });

  // ------------------------------------------------------------------ vendas
  describe('vendas do dia corrente (E5-04)', () => {
    it('grava cupons, itens, finalizadoras e recalcula os agregados', async () => {
      const desfecho = await sync.executar({
        tenantId: tenant.id,
        domain: 'vendas_hoje',
        filialErpId: 1,
      });

      expect(desfecho.status).toBe('success');
      expect(await contar('cupons')).toBeGreaterThan(0);
      expect(await contar('itens')).toBeGreaterThan(0);
      expect(await contar('finalizadoras')).toBeGreaterThan(0);

      const agregados = await tenantDb.run(tenant.id, async (tx) => ({
        horas: await tx.aggVendasHora.count(),
        deps: await tx.aggVendasDiaDep.count(),
      }));
      expect(agregados.horas).toBeGreaterThan(0);
      expect(agregados.deps).toBeGreaterThan(0);
    });

    it('marca o dia corrente como provisório', async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'vendas_hoje', filialErpId: 1 });

      const provisorios = await tenantDb.run(tenant.id, (tx) =>
        tx.erpVendaCupom.count({ where: { isRealtime: true } }),
      );
      expect(provisorios).toBeGreaterThan(0);
    });

    it('repetir a cada 5 minutos reescreve o dia sem duplicar', async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'vendas_hoje', filialErpId: 1 });
      const primeira = await contar('cupons');
      const itensPrimeira = await contar('itens');

      await sync.executar({ tenantId: tenant.id, domain: 'vendas_hoje', filialErpId: 1 });

      expect(await contar('cupons')).toBe(primeira);
      expect(await contar('itens')).toBe(itensPrimeira);
    });

    it('o agregado por hora ignora cupom cancelado', async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'vendas_hoje', filialErpId: 1 });

      const { cupons, agregado } = await tenantDb.run(tenant.id, async (tx) => ({
        cupons: await tx.erpVendaCupom.count({ where: { cancelada: false } }),
        agregado: await tx.aggVendasHora.aggregate({ _sum: { cupons: true } }),
      }));

      expect(agregado._sum.cupons).toBe(cupons);
    });
  });

  describe('consolidação do dia fechado (E5-05)', () => {
    const ontem = () => somarDias(hoje(), -1);

    it('espera o ERP fechar o dia antes de consolidar', async () => {
      // Sem resumo gravado, o job não sabe se o dia acabou — e não inventa.
      const desfecho = await sync.executar({
        tenantId: tenant.id,
        domain: 'vendas_dia',
        filialErpId: 1,
      });

      expect(desfecho.status).toBe('success');
      expect(await contar('cupons')).toBe(0);
      expect(desfecho.resultado?.observacao).toContain('aguardando fechamento');
    });

    it('substitui o provisório pelo definitivo quando o dia está fechado', async () => {
      // 1) provisório de ontem, como se o tempo real o tivesse gravado antes do fechamento
      await sync.executar({
        tenantId: tenant.id,
        domain: 'vendas_dia',
        filialErpId: 1,
        data: ontem(),
        trigger: 'manual',
      });

      await tenantDb.run(tenant.id, async (tx) => {
        await tx.erpVendaCupom.updateMany({ data: { isRealtime: true } });
        // O passo manual já anotou "ontem" como consolidado; para exercitar a cadência, a marca
        // volta ao estado de quem ainda não consolidou nada.
        await tx.syncWatermark.deleteMany({ where: { domain: 'vendas_dia' } });
      });

      // 2) o resumo diário chega dizendo que o dia fechou
      await sync.executar({ tenantId: tenant.id, domain: 'resumo_filial', filialErpId: 1 });

      const fechado = await tenantDb.run(tenant.id, (tx) =>
        tx.erpFilialVendaResumo.findFirst({
          where: { data: new Date(`${ontem()}T00:00:00Z`) },
          select: { gerouVendasDiaria: true },
        }),
      );
      expect(fechado?.gerouVendasDiaria).toBe(true);

      // 3) a consolidação roda e o dia deixa de ser provisório
      const desfecho = await sync.executar({
        tenantId: tenant.id,
        domain: 'vendas_dia',
        filialErpId: 1,
      });
      expect(desfecho.status).toBe('success');

      const cupons = await tenantDb.run(tenant.id, (tx) =>
        tx.erpVendaCupom.findMany({
          where: { data: new Date(`${ontem()}T00:00:00Z`) },
          select: { isRealtime: true },
        }),
      );
      expect(cupons.length).toBeGreaterThan(0);
      expect(cupons.every((cupom) => cupom.isRealtime === false)).toBe(true);

      const marca = await watermarks.obter(tenant.id, 'vendas_dia', 1);
      expect(marca?.watermarkDate).toBe(ontem());
    });
  });

  // ------------------------------------------------------------------ resumo
  describe('resumo diário (E5-06)', () => {
    it('preenche a janela inicial e guarda as marcas de fechamento', async () => {
      const desfecho = await sync.executar({
        tenantId: tenant.id,
        domain: 'resumo_filial',
        filialErpId: 1,
      });

      expect(desfecho.status).toBe('success');
      expect(await contar('resumos')).toBeGreaterThan(20);

      const marca = await watermarks.obter(tenant.id, 'resumo_filial', 1);
      expect(marca?.watermarkDate).toBe(somarDias(hoje(), -1));
    });

    it('respeita o limite de 30 dias da API fatiando a janela', async () => {
      const desfecho = await sync.executar({
        tenantId: tenant.id,
        domain: 'resumo_filial',
        filialErpId: 1,
        periodo: { inicio: somarDias(hoje(), -75), fim: somarDias(hoje(), -1) },
        trigger: 'manual',
      });

      expect(desfecho.status).toBe('success');
      // 75 dias não cabem numa chamada: o job precisou fatiar em três.
      expect(desfecho.resultado?.apiCalls ?? 0).toBeGreaterThanOrEqual(3);
      expect(await contar('resumos')).toBe(75);
    });
  });

  // ------------------------------------------------------------------ orquestração
  describe('orquestração (E5-01)', () => {
    it("a marca d'água não avança quando a execução falha", async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'resumo_filial', filialErpId: 1 });
      const antes = await watermarks.obter(tenant.id, 'resumo_filial', 1);

      // Credencial trocada por uma inválida: a próxima execução falha de verdade.
      await salvarCredencial('senha-que-nao-vale');

      const desfecho = await sync.executar({
        tenantId: tenant.id,
        domain: 'resumo_filial',
        filialErpId: 1,
      });
      expect(desfecho.status).toBe('error');

      const depois = await watermarks.obter(tenant.id, 'resumo_filial', 1);
      expect(depois?.watermarkDate).toBe(antes?.watermarkDate);
      expect(depois?.status).toBe('error');
      expect(depois?.lastError).toBeTruthy();

      // Devolve a credencial boa para os cenários seguintes.
      await salvarCredencial(MOCK_SENHA);
    });

    it('escopo já em execução faz a segunda desistir em vez de disputar', async () => {
      // Um "outro worker" segura o lock do escopo enquanto a execução é tentada aqui. Sem isso o
      // teste dependeria de quem ganha a corrida — e passaria ou falharia por sorte.
      let liberar = (): void => {};
      const ocupado = locks.comLock(
        tenant.id,
        'vendas_hoje:1',
        30,
        () => new Promise<void>((resolve) => (liberar = resolve)),
      );

      await esperarLock(`lock:t:${tenant.id}:sync:vendas_hoje:1`);

      const desfecho = await sync.executar({
        tenantId: tenant.id,
        domain: 'vendas_hoje',
        filialErpId: 1,
      });

      expect(desfecho.status).toBe('skipped');
      expect(desfecho.resultado?.observacao).toContain('já em execução');

      liberar();
      await ocupado;

      // Com o lock livre, a mesma execução passa.
      const depois = await sync.executar({
        tenantId: tenant.id,
        domain: 'vendas_hoje',
        filialErpId: 1,
      });
      expect(depois.status).toBe('success');
    });

    it('a execução que desistiu também entra no histórico', async () => {
      let liberar = (): void => {};
      const ocupado = locks.comLock(
        tenant.id,
        'dimensoes',
        30,
        () => new Promise<void>((resolve) => (liberar = resolve)),
      );
      await esperarLock(`lock:t:${tenant.id}:sync:dimensoes`);

      await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });
      liberar();
      await ocupado;

      const pulados = await tenantDb.run(tenant.id, (tx) =>
        tx.syncJobRun.count({ where: { status: 'skipped' } }),
      );
      expect(pulados).toBe(1);
    });

    it('tenant suspenso não fala com o ERP', async () => {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'suspended', suspendedAt: new Date() },
      });

      const desfecho = await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });
      expect(desfecho.status).toBe('skipped');
      expect(desfecho.resultado?.observacao).toContain('inativo');

      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'active', suspendedAt: null },
      });
    });

    it('toda execução entra no histórico, inclusive a que não fez nada', async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });

      const execucoes = await tenantDb.run(tenant.id, (tx) =>
        tx.syncJobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5 }),
      );

      expect(execucoes.length).toBeGreaterThan(0);
      expect(execucoes[0]).toMatchObject({ domain: 'dimensoes', status: 'success' });
      expect(execucoes[0]?.durationMs).toBeGreaterThanOrEqual(0);
      expect(execucoes[0]?.finishedAt).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------ backfill
  describe('carga histórica (E5-07)', () => {
    it('processa o histórico em passos retomáveis, do mais recente para trás', async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });

      const plano = await backfill.iniciar(tenant.id, { dias: 7, filiais: [1] });
      expect(plano.totalDias).toBe(7);
      expect(plano.etapa).toBe('resumos');

      let passos = 0;
      let concluido = false;
      while (!concluido && passos < 20) {
        ({ concluido } = await backfill.executarPasso(tenant.id));
        passos += 1;
      }

      expect(concluido).toBe(true);
      // Sete dias de uma filial, dois cupons por dia na fixture.
      expect(await contar('cupons')).toBe(14);

      const progresso = await backfill.progresso(tenant.id);
      expect(progresso.ativo).toBe(false);
      expect(progresso.percentual).toBe(100);
    });

    it('refazer a mesma carga não duplica nada', async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });
      await backfill.iniciar(tenant.id, { dias: 3, filiais: [1] });
      while (!(await backfill.executarPasso(tenant.id)).concluido) {
        /* processa até o fim */
      }

      const cupons = await contar('cupons');
      const itens = await contar('itens');

      await backfill.iniciar(tenant.id, { dias: 3, filiais: [1] });
      while (!(await backfill.executarPasso(tenant.id)).concluido) {
        /* de novo, do zero */
      }

      expect(await contar('cupons')).toBe(cupons);
      expect(await contar('itens')).toBe(itens);
    });

    it('recomeça de onde parou quando o processo morre no meio', async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });
      await backfill.iniciar(tenant.id, { dias: 10, filiais: [1] });

      await backfill.executarPasso(tenant.id); // etapa de resumos
      await backfill.executarPasso(tenant.id); // primeira leva de dias

      const parcial = await backfill.progresso(tenant.id);
      expect(parcial.ativo).toBe(true);
      expect(parcial.plano?.diasFeitos).toBeGreaterThan(0);
      expect(parcial.plano?.diasFeitos).toBeLessThan(10);

      // Um "novo processo" continua do plano gravado, sem recomeçar.
      while (!(await backfill.executarPasso(tenant.id)).concluido) {
        /* continua */
      }

      const final = await backfill.progresso(tenant.id);
      expect(final.plano?.diasFeitos).toBe(10);
    });
  });

  // ------------------------------------------------------------------ painel
  describe('painel de sincronização (E5-12)', () => {
    it('mostra frescor por domínio e por filial, com o histórico recente', async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });
      await sync.executar({ tenantId: tenant.id, domain: 'vendas_hoje', filialErpId: 1 });

      const painel = await status.painel(tenant.id);

      const vendas = painel.dominios.find((dominio) => dominio.domain === 'vendas_hoje');
      expect(vendas?.porFilial).toBe(true);
      expect(vendas?.escopos[0]).toMatchObject({ filialErpId: 1, status: 'idle', atrasado: false });
      expect(vendas?.escopos[0]?.ultimoSucesso).toBeTruthy();

      // Domínio que nunca rodou aparece como "nunca", em vez de sumir da tela.
      const produtos = painel.dominios.find((dominio) => dominio.domain === 'produtos');
      expect(produtos?.escopos[0]?.status).toBe('nunca');
      expect(produtos?.escopos[0]?.atrasado).toBe(true);

      expect(painel.execucoes.length).toBeGreaterThan(0);
      expect(typeof painel.execucoes[0]?.id).toBe('string');
    });

    it('o endpoint devolve o painel para quem administra a conexão', async () => {
      await sync.executar({ tenantId: tenant.id, domain: 'dimensoes' });

      const resposta = await dono.get(`${API_PREFIX}/tenant/sync`).expect(200);

      expect(resposta.body.dominios.length).toBeGreaterThan(0);
      expect(resposta.body.backfill).toBeDefined();
    });

    it('pedir ressincronização enfileira sem executar no request', async () => {
      await dono
        .post(`${API_PREFIX}/tenant/sync/resync`)
        .set('x-csrf-token', csrf)
        .send({ domain: 'dimensoes' })
        .expect(202);

      // O request não sincroniza: quem executa é o worker, consumindo a fila.
      const execucoes = await tenantDb.run(tenant.id, (tx) => tx.syncJobRun.count());
      expect(execucoes).toBe(0);
    });

    it('recusa domínio inexistente na ressincronização', async () => {
      await dono
        .post(`${API_PREFIX}/tenant/sync/resync`)
        .set('x-csrf-token', csrf)
        .send({ domain: 'inventado' })
        .expect(422);
    });
  });

  // ------------------------------------------------------------------ contabilidade
  describe('contabilidade de chamadas (doc 05 §2)', () => {
    it('registra chamadas sem guardar payload e respeita a retenção', async () => {
      const runs = app.get(SyncRunService);

      await runs.registrarChamadas(tenant.id, [
        { endpoint: 'GET /filiais', durationMs: 120, items: 3 },
        { endpoint: 'GET /produtos', durationMs: 900, items: 500 },
      ]);

      const linhas = await tenantDb.run(tenant.id, (tx) => tx.syncApiCallLog.findMany());
      expect(linhas).toHaveLength(2);
      expect(Object.keys(linhas[0] ?? {})).not.toContain('payload');

      // Linha antiga sai na purga; a recente fica.
      await tenantDb.run(tenant.id, (tx) =>
        tx.syncApiCallLog.updateMany({
          where: { endpoint: 'GET /filiais' },
          data: { calledAt: new Date(Date.now() - 40 * 86_400_000) },
        }),
      );

      const removidas = await runs.purgarChamadasAntigas(tenant.id, 30);
      expect(removidas).toBe(1);
      expect(await tenantDb.run(tenant.id, (tx) => tx.syncApiCallLog.count())).toBe(1);
    });
  });
});
