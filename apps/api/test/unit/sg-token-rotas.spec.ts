import { rotasDoJwt } from '../../src/integration/sg/sg-token.manager';

/**
 * A autorização da SG manda a lista de rotas em **dois** lugares (coleção oficial, conferida em
 * 24/09/2026): o campo `routes` do corpo e a claim `routes` do token. Ler só um dos dois deixa o
 * portão de contrato desligado em silêncio, que é o que o doc 34 §4.7 (defeito 3) não conseguiu
 * explicar na época.
 */
describe('rotasDoJwt', () => {
  /** Payload do exemplo publicado pela SG: 28 rotas, idênticas às do corpo. */
  const jwtDocumentado = (() => {
    const payload = {
      routes: [
        'GET /integracao/sgsistemas/v1/filiais',
        'GET /integracao/sgsistemas/v1/produtos',
        'POST /integracao/sgsistemas/v1/clientes',
      ],
      usuario: 'lojaaqui',
      expire_time: '2023-01-25 11:38:35',
    };
    return `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.assinatura`;
  })();

  /**
   * Token real da homologação deste tenant (24/09/2026). O payload tem só `usuario` e
   * `expire_time` — esta instalação de fato não informa rotas, nem no corpo nem na claim.
   */
  const jwtReal =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c3VhcmlvIjoiaG9tb2xvZ2FjYW8iLCJleHBpcmVfdGltZSI6IjIwMjYtMDktMjMgMjM6NTY6NTYifQ.55cq1m2TIDzt29WRcpDWVwBgvbC8OCjIrspq5BW2hT0';

  it('lê a claim `routes` e normaliza igual ao corpo (caixa e espaços)', () => {
    expect(rotasDoJwt(jwtDocumentado)).toEqual([
      'GET /INTEGRACAO/SGSISTEMAS/V1/FILIAIS',
      'GET /INTEGRACAO/SGSISTEMAS/V1/PRODUTOS',
      'POST /INTEGRACAO/SGSISTEMAS/V1/CLIENTES',
    ]);
  });

  it('token sem a claim devolve lista vazia — é o caso real desta homologação', () => {
    expect(rotasDoJwt(jwtReal)).toEqual([]);
  });

  it('não quebra com token opaco, payload ilegível ou claim de tipo errado', () => {
    expect(rotasDoJwt('nao-e-um-jwt')).toEqual([]);
    expect(rotasDoJwt('a.$$$.c')).toEqual([]);
    expect(rotasDoJwt('')).toEqual([]);

    const claimTorta = `a.${Buffer.from(JSON.stringify({ routes: 'GET /filiais' })).toString('base64url')}.c`;
    expect(rotasDoJwt(claimTorta)).toEqual([]);
  });

  it('descarta entradas que não são string em vez de derrubar a autenticação', () => {
    const misto = `a.${Buffer.from(
      JSON.stringify({ routes: ['GET /filiais', 42, null, 'GET /produtos'] }),
    ).toString('base64url')}.c`;

    expect(rotasDoJwt(misto)).toEqual(['GET /FILIAIS', 'GET /PRODUTOS']);
  });
});
