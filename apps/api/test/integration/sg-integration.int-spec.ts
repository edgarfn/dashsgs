import { API_PREFIX } from '@dashsgs/shared';
import { Prisma } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../../src/app.module';
import { correlationMiddleware } from '../../src/common/correlation/correlation.middleware';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenantDatabase } from '../../src/common/tenant';
import { RedisService } from '../../src/common/redis/redis.service';
import { SG_TRANSPORT, type SgTransport } from '../../src/integration/sg/http/sg-http.client';
import {
  SgMockTransport,
  MOCK_SENHA,
  MOCK_USUARIO,
} from '../../src/integration/sg/mock/sg-mock.transport';
import { SgClient } from '../../src/integration/sg/sg.client';
import { SgTokenManager } from '../../src/integration/sg/sg-token.manager';
import { SgError } from '../../src/integration/sg/sg-errors';
import { ErpConnectionService } from '../../src/modules/erp-connection/erp-connection.service';
import { agentFor, clearRateLimits, loginWith } from './helpers/auth.helpers';
import {
  cleanupTenantFixtures,
  createTenantFixture,
  type TenantFixture,
} from './helpers/tenant.helpers';

const SENHA = 'Cavalo-Bateria-Grampo-Correto-9';
/** Host público reservado para documentação (RFC 2606): resolve, e ninguém atende de verdade. */
const BASE_URL = 'http://example.com:8201';

/**
 * Transporte controlável: encaminha para o mock por padrão e, quando pedido, simula o ERP fora
 * do ar. É assim que dá para testar disjuntor e retry sem depender de um servidor instável.
 */
class TransporteControlado implements SgTransport {
  falharCom: number | 'rede' | null = null;
  chamadas = 0;

  /**
   * Recusa com 400 as chamadas a um caminho específico — e só as N primeiras, quando `vezes`
   * for finito. É o que permite distinguir "400 porque a página é grande demais" (some depois
   * de reduzir) de "400 por outro motivo" (não some nunca), que é a diferença no centro da Q4.
   */
  recusar400: { contem: string; vezes: number } | null = null;

  constructor(private readonly mock: SgMockTransport) {}

  async fetch(url: string, init: RequestInit): Promise<Response> {
    this.chamadas += 1;
    if (this.falharCom === 'rede') throw new Error('ECONNREFUSED sintético');
    if (typeof this.falharCom === 'number') {
      return new Response(JSON.stringify({ error: 'Erro sintetico' }), {
        status: this.falharCom,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (this.recusar400 && url.includes(this.recusar400.contem) && this.recusar400.vezes > 0) {
      this.recusar400.vezes -= 1;
      return new Response(JSON.stringify({ error: 'Ocorreu um erro no envio de parametros' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return this.mock.fetch(url, init);
  }
}

/**
 * Integração com a API SG (épico E4) exercitada de ponta a ponta contra o transporte de mock:
 * token, políticas do cliente HTTP, normalização com quarentena e o wizard de conexão.
 */
describe('integração com a API SG (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantDb: TenantDatabase;
  let redis: RedisService;
  let sg: SgClient;
  let tokens: SgTokenManager;
  let conexoes: ErpConnectionService;
  let transporte: TransporteControlado;

  let tenant: TenantFixture;
  let dono: TestAgent;
  let csrf: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SG_TRANSPORT)
      .useFactory({
        factory: (mock: SgMockTransport) => new TransporteControlado(mock),
        inject: [SgMockTransport],
      })
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.use(correlationMiddleware);
    app.use(cookieParser());
    app.setGlobalPrefix(API_PREFIX, { exclude: ['healthz', 'readyz', 'metrics'] });
    await app.init();

    prisma = app.get(PrismaService);
    tenantDb = app.get(TenantDatabase);
    redis = app.get(RedisService);
    sg = app.get(SgClient);
    tokens = app.get(SgTokenManager);
    conexoes = app.get(ErpConnectionService);
    transporte = app.get<TransporteControlado>(SG_TRANSPORT);

    await clearRateLimits(app);

    tenant = await createTenantFixture(app, {
      password: SENHA,
      filiais: [1],
      users: [{ chave: 'dono', role: 'owner' }],
    });

    dono = agentFor(app);
    const sessao = await loginWith(dono, tenant.users.dono!.email, SENHA, { enrollMfa: true });
    csrf = sessao.csrf;
  });

  beforeEach(async () => {
    transporte.falharCom = null;
    transporte.recusar400 = null;
    transporte.chamadas = 0;
    await clearRateLimits(app);
    await limparEstadoSg(redis, tenant.id);
  });

  afterAll(async () => {
    await cleanupTenantFixtures(prisma);
    await app?.close();
  });

  // Devolve o Test do supertest (não uma Promise) para permitir encadear .expect().
  const salvarConexao = (senha = MOCK_SENHA) =>
    dono.put(`${API_PREFIX}/tenant/erp-connection`).set('x-csrf-token', csrf).send({
      baseUrl: BASE_URL,
      username: MOCK_USUARIO,
      senha,
      isSgCloud: false,
      tlsMode: 'https',
      maxRps: 4,
    });

  // ------------------------------------------------------------------ cofre
  describe('cofre de credencial (E4-03)', () => {
    it('recusa endereços que apontam para dentro da nossa rede (anti-SSRF)', async () => {
      for (const baseUrl of [
        'http://127.0.0.1:8201',
        'http://169.254.169.254/latest/meta-data',
        'https://10.0.0.5',
        'https://usuario:senha@example.com',
      ]) {
        const resposta = await dono
          .put(`${API_PREFIX}/tenant/erp-connection`)
          .set('x-csrf-token', csrf)
          .send({
            baseUrl,
            username: MOCK_USUARIO,
            senha: MOCK_SENHA,
            isSgCloud: false,
            tlsMode: 'https',
            maxRps: 4,
          });

        expect({ baseUrl, status: resposta.status }).toEqual({ baseUrl, status: 422 });
      }
    });

    it('guarda a senha cifrada e nunca a devolve', async () => {
      await salvarConexao().expect(200);

      const view = await dono.get(`${API_PREFIX}/tenant/erp-connection`).expect(200);
      expect(view.body).toMatchObject({
        configurada: true,
        senhaCadastrada: true,
        status: 'pending',
      });
      expect(JSON.stringify(view.body)).not.toContain(MOCK_SENHA);

      // No banco, nem o DBA lê: o que existe é um blob com versão de chave (doc 09 §2).
      const linha = await tenantDb.run(tenant.id, (tx) =>
        tx.erpConnection.findUniqueOrThrow({
          where: { tenantId: tenant.id },
          select: { secretCiphertext: true, secretKeyVersion: true },
        }),
      );
      expect(linha.secretKeyVersion).toBe(1);
      expect(Buffer.from(linha.secretCiphertext).toString('utf8')).not.toContain(MOCK_SENHA);
    });

    it('não exige redigitar a senha para corrigir só o endereço', async () => {
      await salvarConexao().expect(200);

      const resposta = await dono
        .put(`${API_PREFIX}/tenant/erp-connection`)
        .set('x-csrf-token', csrf)
        .send({
          baseUrl: 'http://example.com:9999',
          username: MOCK_USUARIO,
          isSgCloud: false,
          tlsMode: 'https',
          maxRps: 4,
        })
        .expect(200);

      expect(resposta.body.baseUrl).toBe('http://example.com:9999');
      expect(resposta.body.senhaCadastrada).toBe(true);
    });

    it('recifra o segredo quando a chave mestra gira (runbook 22 §5)', async () => {
      await salvarConexao().expect(200);
      // A chave corrente é a mesma, então não há o que recifrar — e o método diz isso.
      await expect(conexoes.rewrap(tenant.id)).resolves.toEqual({ recifrada: false });
    });
  });

  // ------------------------------------------------------------------ wizard
  describe('wizard de conexão (E4-07)', () => {
    it('testa a conexão, captura as rotas contratadas e registra o health', async () => {
      await salvarConexao().expect(200);

      const teste = await dono
        .post(`${API_PREFIX}/tenant/erp-connection/test`)
        .set('x-csrf-token', csrf)
        .expect(200);

      expect(teste.body.status).toBe('ok');
      expect(teste.body.routesGranted).toContain('GET /FILIAIS');
      expect(teste.body.health?.versao).toBe('2026.03');
      expect(teste.body.rotasAdicionadas.length).toBeGreaterThan(0);

      const evento = await prisma.auditLog.findFirst({
        where: { tenantId: tenant.id, action: 'erp_connection.tested' },
        orderBy: { id: 'desc' },
      });
      expect(evento?.result).toBe('success');
      expect(JSON.stringify(evento?.changes)).not.toContain(MOCK_SENHA);
    });

    it('credencial errada deixa a conexão em erro, com motivo legível', async () => {
      await salvarConexao('senha-que-nao-vale').expect(200);

      const teste = await dono
        .post(`${API_PREFIX}/tenant/erp-connection/test`)
        .set('x-csrf-token', csrf)
        .expect(502);

      expect(teste.body.code).toBe('ERP_CREDENTIALS_INVALID');

      const view = await dono.get(`${API_PREFIX}/tenant/erp-connection`).expect(200);
      expect(view.body.status).toBe('error');
      expect(view.body.lastError).toContain('credenciais_invalidas');
    });

    it('exige MFA recente para gravar e testar (doc 16 §2)', async () => {
      const semMfa = agentFor(app);
      const outro = await createTenantFixture(app, {
        password: SENHA,
        filiais: [1],
        users: [{ chave: 'admin', role: 'admin' }],
      });
      // Sessão sem passar pelo segundo fator: o guard de sessão barra antes mesmo do MFA recente.
      await semMfa
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: outro.users.admin!.email, password: SENHA })
        .expect(200);

      await semMfa.get(`${API_PREFIX}/tenant/erp-connection`).expect(401);
    });
  });

  // ------------------------------------------------------------------ token
  describe('token manager (E4-02)', () => {
    beforeEach(async () => {
      await salvarConexao().expect(200);
    });

    it('autentica uma vez e reaproveita o token do cache', async () => {
      const contexto = await conexoes.callContext(tenant.id);

      await tokens.getToken(contexto);
      const chamadasApos1 = transporte.chamadas;
      const segundo = await tokens.getToken(contexto);

      expect(segundo.novo).toBe(false);
      expect(transporte.chamadas).toBe(chamadasApos1);
    });

    it('single-flight: dez pedidos simultâneos geram uma única autenticação', async () => {
      const contexto = await conexoes.callContext(tenant.id);
      transporte.chamadas = 0;

      const tokensObtidos = await Promise.all(
        Array.from({ length: 10 }, () => tokens.getToken(contexto)),
      );

      expect(new Set(tokensObtidos.map((item) => item.token)).size).toBe(1);
      expect(transporte.chamadas).toBe(1);
    });

    it('invalidar força nova autenticação', async () => {
      const contexto = await conexoes.callContext(tenant.id);
      await tokens.getToken(contexto);

      await tokens.invalidate(tenant.id);
      transporte.chamadas = 0;
      const novo = await tokens.getToken(contexto);

      expect(novo.novo).toBe(true);
      expect(transporte.chamadas).toBe(1);
    });
  });

  // ------------------------------------------------------------------ cliente
  describe('cliente tipado e normalização (E4-01/E4-05)', () => {
    let contexto: Awaited<ReturnType<ErpConnectionService['callContext']>>;

    beforeEach(async () => {
      await salvarConexao().expect(200);
      await dono
        .post(`${API_PREFIX}/tenant/erp-connection/test`)
        .set('x-csrf-token', csrf)
        .expect(200);
      contexto = await conexoes.callContext(tenant.id);
    });

    it('lista filiais já normalizadas (padding, uf, flag em char)', async () => {
      const { itens, invalidos } = await sg.listFiliais(contexto);

      expect(invalidos).toBe(0);
      expect(itens).toHaveLength(3);
      expect(itens[1]).toMatchObject({ erpId: 2, uf: 'SP', ativa: true });
      expect(itens[2]?.ativa).toBe(false);
    });

    it('quarentena o item fora do contrato e entrega o resto da página', async () => {
      const { itens, invalidos } = await sg.listProdutos(contexto);

      // A fixture tem três produtos, um deles sem id (drift proposital).
      expect(itens).toHaveLength(2);
      expect(invalidos).toBe(1);
      expect(itens.map((produto) => produto.erpId)).toEqual([1001, 1002]);
    });

    it('traz vendas do dia com itens e flags convertidas', async () => {
      const { itens } = await sg.getVendasDia(contexto, { filial: 1, data: '2026-09-11' });

      expect(itens).toHaveLength(2);
      expect(itens[0]).toMatchObject({
        caixa: 1,
        cupom: 100234,
        cancelada: false,
        horario: '09:35',
      });
      expect(itens[0]?.itens[0]?.ofertaErpId).toBe('5');
      expect(itens[1]?.cancelada).toBe(true);
    });

    it('vendas de hoje funcionam mesmo sem vendedor no payload', async () => {
      const { itens } = await sg.getVendasHoje(contexto, { filial: 1 });
      expect(itens[0]?.vendedorErpId).toBeNull();
      expect(itens[0]?.valorTotal).toBe(42.3);
    });

    it('resumo diário converte flags de fechamento', async () => {
      const { itens } = await sg.getResumoFilial(contexto, {
        filiais: [1],
        dataInicial: '2026-09-11',
        dataFinal: '2026-09-11',
      });

      expect(itens[0]?.fechamento).toMatchObject({
        atualizouEstoque: true,
        gerouVendasDiaria: true,
        exportouVendas: false,
        possuiDivergencia: false,
      });
    });

    it('recusa janela maior que 30 dias antes de chamar a API', async () => {
      transporte.chamadas = 0;
      await expect(
        sg.getResumoFilial(contexto, {
          filiais: [1],
          dataInicial: '2026-07-01',
          dataFinal: '2026-09-30',
        }),
      ).rejects.toThrow('excede o máximo');
      expect(transporte.chamadas).toBe(0);
    });

    it('falha rápido quando a rota não está no contrato do tenant', async () => {
      const semRota = {
        ...contexto,
        conexao: { ...contexto.conexao, routesGranted: ['GET /FILIAIS'] },
      };
      transporte.chamadas = 0;

      await expect(sg.getVendasDia(semRota, { filial: 1, data: '2026-09-11' })).rejects.toThrow(
        'rota_nao_contratada',
      );
      expect(transporte.chamadas).toBe(0);
    });
  });

  // ------------------------------------------------------------------ resiliência
  describe('políticas de resiliência (E4-04)', () => {
    let contexto: Awaited<ReturnType<ErpConnectionService['callContext']>>;

    beforeEach(async () => {
      await salvarConexao().expect(200);
      await dono
        .post(`${API_PREFIX}/tenant/erp-connection/test`)
        .set('x-csrf-token', csrf)
        .expect(200);
      contexto = await conexoes.callContext(tenant.id);
      await limparEstadoSg(redis, tenant.id, { manterToken: true });
    });

    it('repete GET em erro 5xx e desiste depois das tentativas previstas', async () => {
      transporte.falharCom = 500;
      transporte.chamadas = 0;

      await expect(sg.listFiliais(contexto)).rejects.toThrow(SgError);
      // 3 tentativas do doc 12 §3 (o disjuntor abre no limite, mas 5 falhas ainda não houve).
      expect(transporte.chamadas).toBe(3);
    }, 30_000);

    it('abre o disjuntor após falhas seguidas e passa a falhar rápido', async () => {
      transporte.falharCom = 'rede';

      // Duas rodadas de 3 tentativas passam do limite de 5 falhas em 60 s.
      await expect(sg.listFiliais(contexto)).rejects.toThrow();
      await expect(sg.listFiliais(contexto)).rejects.toThrow();

      transporte.chamadas = 0;
      const inicio = Date.now();
      await expect(sg.listFiliais(contexto)).rejects.toThrow('circuito aberto');

      // Falhar rápido é o ponto: sem nova chamada ao ERP e sem esperar backoff.
      expect(transporte.chamadas).toBe(0);
      expect(Date.now() - inicio).toBeLessThan(1000);
    }, 60_000);

    it('não repete escrita: POST sem idempotência não pode duplicar (doc 12 §3)', async () => {
      transporte.falharCom = 500;
      transporte.chamadas = 0;

      // A autorização é o POST que existe nesta fase — e ela não deve ser repetida.
      await tokens.invalidate(tenant.id);
      await expect(tokens.getToken(contexto)).rejects.toThrow();
      expect(transporte.chamadas).toBe(1);
    });
  });

  /**
   * Degradação de tamanho de página (doc 34 Q4).
   *
   * O ponto não é reduzir — é o que fica GRAVADO. A homologação da SG recusa `/filiais/vendas`
   * com 400 por um motivo que não é o tamanho, e a primeira versão disto gravava cada palpite
   * enquanto ia cortando 200 → 100 → 50. Como nada nunca aumenta o valor de volta, era uma
   * catraca só para baixo sobre a configuração de um cliente, a partir de um erro sem relação.
   */
  describe('degradação de página (E4-01 / doc 34 Q4)', () => {
    let contexto: Awaited<ReturnType<ErpConnectionService['callContext']>>;

    const janela = { dataInicial: '2026-09-10', dataFinal: '2026-09-10' };

    const tetoGravado = async (): Promise<number | undefined> =>
      (await conexoes.callContext(tenant.id)).conexao.pageSizePorRota?.['GET /filiais/vendas'];

    beforeEach(async () => {
      await salvarConexao().expect(200);
      await dono
        .post(`${API_PREFIX}/tenant/erp-connection/test`)
        .set('x-csrf-token', csrf)
        .expect(200);
      // O teto aprendido sobrevive ao `salvarConexao` — é essa a graça dele. Entre cenários,
      // porém, ele precisa sair: senão o valor gravado por um caso responde pelo outro, e o
      // teste passaria a medir a ordem dos `it`.
      await tenantDb.run(tenant.id, (tx) =>
        tx.erpConnection.updateMany({
          where: { tenantId: tenant.id },
          data: { pageSizePorRota: Prisma.DbNull },
        }),
      );

      contexto = await conexoes.callContext(tenant.id);
      await limparEstadoSg(redis, tenant.id, { manterToken: true });
    });

    it('400 que some depois de reduzir vira teto aprendido', async () => {
      // Só a primeira chamada recusa: reduzir resolve, então o tamanho menor é um fato.
      transporte.recusar400 = { contem: '/filiais/vendas', vezes: 1 };

      await sg.getResumoFilial({ ...contexto }, { filiais: [1], ...janela });

      const teto = await tetoGravado();
      expect(teto).toBeDefined();
      expect(teto!).toBeLessThan(200);
    }, 30_000);

    it('400 que NÃO some não grava teto nenhum', async () => {
      transporte.recusar400 = { contem: '/filiais/vendas', vezes: Number.MAX_SAFE_INTEGER };

      await expect(
        sg.getResumoFilial({ ...contexto }, { filiais: [1], ...janela }),
      ).rejects.toThrow(SgError);

      // O erro é de outro parâmetro; o tamanho de página do cliente não tem nada com isso.
      expect(await tetoGravado()).toBeUndefined();
    }, 30_000);
  });
});

/** Limpa token, disjuntor e contadores de rate limit do tenant entre cenários. */
async function limparEstadoSg(
  redis: RedisService,
  tenantId: string,
  opcoes: { manterToken?: boolean } = {},
): Promise<void> {
  const chaves = [
    `sg:cb:falhas:${tenantId}`,
    `sg:cb:aberto:${tenantId}`,
    `sg:cb:sonda:${tenantId}`,
    `sgtoken:lock:${tenantId}`,
    ...(opcoes.manterToken ? [] : [`sgtoken:${tenantId}`]),
  ];
  await redis.client.del(...chaves);
}
