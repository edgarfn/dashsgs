import { aplicarPrefixo, lerRetryAfter } from '../../src/integration/sg/http/sg-http.client';
import { classificarResposta } from '../../src/integration/sg/sg-errors';

/**
 * As respostas que a SG ainda não deu, como configuração (doc 34 Q1–Q5).
 *
 * O que estes testes protegem não é uma feature: é a propriedade de que **nenhuma resposta
 * pendente está cravada no código**. Quando a SG responder, o ajuste tem de ser um UPDATE numa
 * conexão — não um deploy.
 */

describe('Q5 — prefixo das rotas', () => {
  it('sem prefixo, o caminho passa intacto', () => {
    expect(aplicarPrefixo('/integracao/sgsistemas/v1/filiais', '')).toBe(
      '/integracao/sgsistemas/v1/filiais',
    );
    expect(aplicarPrefixo('/integracao/sgsistemas/v1/filiais', null)).toBe(
      '/integracao/sgsistemas/v1/filiais',
    );
  });

  it('com prefixo, ele vale para as rotas de DADOS — que é o cenário da pergunta', () => {
    // Se a SG responder "o /public vale para a API inteira", é esta linha que faz o produto
    // continuar funcionando sem mudar código.
    expect(aplicarPrefixo('/integracao/sgsistemas/v1/vendas', '/public')).toBe(
      '/public/integracao/sgsistemas/v1/vendas',
    );
  });

  it('não duplica o prefixo num caminho que já o tem', () => {
    // A autorização do SG Cloud já carrega /public na própria constante. Sem esta guarda, ligar
    // o prefixo global quebraria justamente a instalação que precisava do ajuste.
    expect(aplicarPrefixo('/public/integracao/sgsistemas/v1/autorizacao', '/public')).toBe(
      '/public/integracao/sgsistemas/v1/autorizacao',
    );
  });

  it('tolera barra sobrando no fim do prefixo', () => {
    expect(aplicarPrefixo('/v1/filiais', '/public/')).toBe('/public/v1/filiais');
  });
});

describe('Q3 — limite de requisições', () => {
  it('429 vira falha própria e retentável, não quarentena', () => {
    const erro = classificarResposta(429, { error: 'Too Many Requests' }, { endpoint: '/vendas' });

    // Antes, 429 caía no ramo final e virava `resposta_invalida` — que na taxonomia significa
    // "não repetir, quarentenar". O produto jogaria a página fora e marcaria o dado do cliente
    // como inválido porque o servidor pediu calma.
    expect(erro.falha).toBe('limite_excedido');
    expect(erro.retentavel).toBe(true);
  });

  it('lê Retry-After em segundos', () => {
    expect(lerRetryAfter('30')).toBe(30_000);
  });

  it('lê Retry-After como data HTTP', () => {
    const daquiA20s = new Date(Date.now() + 20_000).toUTCString();
    const lido = lerRetryAfter(daquiA20s);
    expect(lido).toBeGreaterThan(10_000);
    expect(lido).toBeLessThanOrEqual(20_000);
  });

  it('ignora Retry-After ausente, vencido ou ilegível — o backoff normal assume', () => {
    expect(lerRetryAfter(null)).toBeUndefined();
    expect(lerRetryAfter('0')).toBeUndefined();
    expect(lerRetryAfter('-5')).toBeUndefined();
    expect(lerRetryAfter('depois')).toBeUndefined();
    expect(lerRetryAfter(new Date(Date.now() - 60_000).toUTCString())).toBeUndefined();
  });

  it('a espera do 429 chega ao erro para quem for decidir o backoff', () => {
    const erro = classificarResposta(429, null, { endpoint: '/vendas', retryAfterMs: 5_000 });
    expect(erro.esperaSugeridaMs).toBe(5_000);
  });
});
