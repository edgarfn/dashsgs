import {
  autorizacaoResponseSchema,
  dimensaoSchema,
  filialSchema,
  produtoSchema,
  statusSchema,
} from '../../src/integration/sg/types';
import { normalizarPagina } from '../../src/integration/sg/normalizers';

/**
 * Testes de contrato contra a **homologação da SG** (doc 12 §7 / E4-08).
 *
 * Rodam no job noturno do CI, não no PR: eles dependem de um servidor de terceiro e de
 * credenciais que vivem em secret. O objetivo não é testar o nosso código — é detectar **drift**:
 * o dia em que a API mudar um campo, um envelope ou um tipo, queremos saber pelo alerta da noite,
 * e não pelo cliente ligando.
 *
 * Sem as credenciais no ambiente, a suíte é pulada com aviso explícito. Falhar aqui por falta de
 * segredo ensinaria a equipe a ignorar o vermelho.
 */
const BASE_URL = process.env.SG_HOMOLOG_BASE_URL;
const USUARIO = process.env.SG_HOMOLOG_USER;
const SENHA = process.env.SG_HOMOLOG_PASSWORD;

const temCredenciais = Boolean(BASE_URL && USUARIO && SENHA);
const descreve = temCredenciais ? describe : describe.skip;

if (!temCredenciais) {
  // eslint-disable-next-line no-console -- é a única forma de o job noturno explicar o pulo
  console.warn(
    'Contrato SG pulado: defina SG_HOMOLOG_BASE_URL, SG_HOMOLOG_USER e SG_HOMOLOG_PASSWORD.',
  );
}

const TIMEOUT = 60_000;

interface Sessao {
  token: string;
  routes: string[];
  headerMode: 'raw' | 'bearer';
}

descreve('contrato com a API SG (homologação)', () => {
  let sessao: Sessao;

  const chamar = async (caminho: string, query: Record<string, string> = {}) => {
    const url = new URL(caminho, BASE_URL);
    for (const [chave, valor] of Object.entries(query)) url.searchParams.set(chave, valor);

    const resposta = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: sessao.headerMode === 'bearer' ? `Bearer ${sessao.token}` : sessao.token,
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    return { status: resposta.status, corpo: await resposta.json().catch(() => null) };
  };

  beforeAll(async () => {
    const resposta = await fetch(new URL('/integracao/sgsistemas/v1/autorizacao', BASE_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: USUARIO, senha: SENHA }),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    expect(resposta.status).toBe(200);
    const dados = autorizacaoResponseSchema.parse(await resposta.json());

    // Descobre o formato aceito do header (doc 34 Q2, sem resposta oficial) e deixa registrado
    // no relatório do job — é uma informação que vale para a configuração de todo tenant.
    sessao = { token: dados.token, routes: dados.routes, headerMode: 'raw' };
    const sonda = await chamar('/sgsistemas/v1/status');
    if (sonda.status === 401) sessao.headerMode = 'bearer';

    // eslint-disable-next-line no-console -- relatório do job noturno
    console.info(
      `[contrato SG] header aceito: ${sessao.headerMode}; rotas no contrato: ${dados.routes.length}`,
    );
  }, TIMEOUT);

  it(
    'a autorização devolve token, rotas e validade',
    () => {
      expect(sessao.token.length).toBeGreaterThan(20);
      expect(Array.isArray(sessao.routes)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'GET /status continua no formato esperado',
    async () => {
      const { status, corpo } = await chamar('/sgsistemas/v1/status');
      expect(status).toBe(200);
      expect(() => statusSchema.parse(corpo)).not.toThrow();
    },
    TIMEOUT,
  );

  it(
    'GET /filiais continua no formato esperado',
    async () => {
      const { status, corpo } = await chamar('/integracao/sgsistemas/v1/filiais');
      expect(status).toBe(200);

      const pagina = normalizarPagina(corpo, 'filiais');
      expect(pagina.itens.length).toBeGreaterThan(0);

      const invalidos = pagina.itens.filter((item) => !filialSchema.safeParse(item).success);
      expect({ recurso: 'filiais', invalidos: invalidos.length }).toEqual({
        recurso: 'filiais',
        invalidos: 0,
      });
    },
    TIMEOUT,
  );

  it(
    'GET /marcas e /departamentos/nivel1 continuam no formato esperado',
    async () => {
      for (const recurso of ['marcas', 'departamentos/nivel1']) {
        const { status, corpo } = await chamar(`/integracao/sgsistemas/v1/${recurso}`);
        expect({ recurso, status }).toEqual({ recurso, status: 200 });

        const pagina = normalizarPagina(corpo);
        const invalidos = pagina.itens.filter((item) => !dimensaoSchema.safeParse(item).success);
        expect({ recurso, invalidos: invalidos.length }).toEqual({ recurso, invalidos: 0 });
      }
    },
    TIMEOUT,
  );

  it(
    'GET /produtos continua no formato esperado (primeira página)',
    async () => {
      const { status, corpo } = await chamar('/integracao/sgsistemas/v1/produtos', {
        pagina: '1',
        itensPorPagina: '50',
      });
      expect(status).toBe(200);

      const pagina = normalizarPagina(corpo, 'produtos');
      const invalidos = pagina.itens.filter((item) => !produtoSchema.safeParse(item).success);

      // Drift real aparece aqui: campo renomeado, tipo trocado, id que sumiu.
      expect({ recurso: 'produtos', invalidos: invalidos.length }).toEqual({
        recurso: 'produtos',
        invalidos: 0,
      });
    },
    TIMEOUT,
  );

  it(
    'as rotas do contrato de homologação cobrem o que a Fase 6 vai sincronizar',
    () => {
      const necessarias = ['FILIAIS', 'PRODUTOS', 'VENDAS'];
      const faltando = necessarias.filter(
        (rota) => !sessao.routes.some((concedida) => concedida.includes(rota)),
      );

      // Não é falha do nosso código: é sinal de que o contrato mudou e o produto vai degradar.
      expect({ faltando }).toEqual({ faltando: [] });
    },
    TIMEOUT,
  );
});
