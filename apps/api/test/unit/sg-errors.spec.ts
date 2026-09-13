import { classificarResposta, SgError } from '../../src/integration/sg/sg-errors';
import { assertJanela, assertRotaContratada } from '../../src/integration/sg/sg.client';
import { rotuloEndpoint } from '../../src/integration/sg/http/sg-http.client';

/** Tradução de erros da API SG (doc 12 §8) — define o que repete, o que para e o que alerta. */
describe('classificação de resposta da API SG', () => {
  const ctx = { endpoint: '/filiais' };

  it('401 na autorização é credencial inválida (pede intervenção humana)', () => {
    const erro = classificarResposta(401, null, { ...ctx, autorizacao: true });
    expect(erro.falha).toBe('credenciais_invalidas');
    expect(erro.retentavel).toBe(false);
    expect(erro.exigeIntervencao).toBe(true);
  });

  it('401 numa rota é token vencido na primeira vez e rota não contratada na segunda', () => {
    expect(classificarResposta(401, null, ctx).falha).toBe('token_expirado');
    expect(classificarResposta(401, null, { ...ctx, segundaTentativa: true }).falha).toBe(
      'rota_nao_contratada',
    );
  });

  it('400 com "não encontrado" é vazio, não erro (doc 02 §4.8)', () => {
    const erro = classificarResposta(400, { error: 'Nenhum registro encontrado' }, ctx);
    expect(erro.falha).toBe('nao_encontrado');
  });

  it('400 de parâmetro obrigatório é bug nosso e não repete', () => {
    const erro = classificarResposta(400, { error: 'Parametros obrigatorios: filial, data' }, ctx);
    expect(erro.falha).toBe('requisicao_invalida');
    expect(erro.retentavel).toBe(false);
  });

  it('5xx e rede repetem com backoff', () => {
    expect(classificarResposta(500, null, ctx).retentavel).toBe(true);
    expect(classificarResposta(503, null, ctx).retentavel).toBe(true);
    expect(new SgError('inalcancavel').retentavel).toBe(true);
  });

  it('a mensagem para o usuário nunca repassa o texto cru do ERP', () => {
    const erro = classificarResposta(
      500,
      { error: 'ORA-00942: tabela ou view inexistente em CADPRO' },
      ctx,
    );
    const app = erro.toAppException();

    expect(app.message).not.toContain('ORA-00942');
    expect(app.message).not.toContain('CADPRO');
    // O detalhe fica no contexto de log, para quem investiga.
    expect(JSON.stringify(app.logContext)).toContain('ORA-00942');
  });

  it('mapeia cada falha para um código do catálogo interno (doc 23)', () => {
    expect(new SgError('credenciais_invalidas').toAppException().code).toBe(
      'ERP_CREDENTIALS_INVALID',
    );
    expect(new SgError('rota_nao_contratada').toAppException().code).toBe('ERP_ROUTE_FORBIDDEN');
    expect(new SgError('nao_encontrado').toAppException().code).toBe('NOT_FOUND');
    expect(new SgError('inalcancavel').toAppException().code).toBe('ERP_UNREACHABLE');
  });
});

describe('verificação de rota contratada (doc 12 §5)', () => {
  const rotas = ['GET /filiais', 'GET /vendas', 'GET /produtos'];

  it('deixa passar rota presente na claim do token', () => {
    expect(() => assertRotaContratada(rotas, 'GET /filiais')).not.toThrow();
  });

  it('falha rápido quando a rota não está no contrato', () => {
    expect(() => assertRotaContratada(rotas, 'GET /clientes')).toThrow('SG:rota_nao_contratada');
  });

  it('confere o método, não só o caminho', () => {
    expect(() => assertRotaContratada(rotas, 'POST /vendas')).toThrow();
  });

  it('tolera caminho completo na claim (formato não documentado)', () => {
    const completas = ['GET /integracao/sgsistemas/v1/filiais'];
    expect(() => assertRotaContratada(completas, 'GET /filiais')).not.toThrow();
  });

  it('sem rotas conhecidas (primeiro uso) não bloqueia', () => {
    expect(() => assertRotaContratada([], 'GET /qualquer')).not.toThrow();
  });
});

describe('janela máxima de 30 dias (doc 03)', () => {
  it('aceita período dentro do limite', () => {
    expect(() => assertJanela('2026-09-01', '2026-09-30')).not.toThrow();
    expect(() => assertJanela('2026-09-01', '2026-09-01')).not.toThrow();
  });

  it('recusa período maior que 30 dias antes de chamar a API', () => {
    expect(() => assertJanela('2026-08-01', '2026-09-30')).toThrow('excede o máximo');
  });

  it('recusa intervalo invertido e datas inválidas', () => {
    expect(() => assertJanela('2026-09-30', '2026-09-01')).toThrow();
    expect(() => assertJanela('ontem', 'hoje')).toThrow();
  });
});

describe('rótulo de endpoint para métrica', () => {
  it('remove o prefixo da API e troca ids por :id (cardinalidade — doc 18 §2)', () => {
    expect(rotuloEndpoint('/integracao/sgsistemas/v1/filiais')).toBe('/filiais');
    expect(rotuloEndpoint('/integracao/sgsistemas/v1/pedidoscompra/12345/produtos')).toBe(
      '/pedidoscompra/:id/produtos',
    );
    expect(rotuloEndpoint('/sgsistemas/v1/status')).toBe('/sgsistemas/v1/status');
  });
});
