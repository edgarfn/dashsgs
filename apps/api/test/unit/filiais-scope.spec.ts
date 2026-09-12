import { type AppException } from '../../src/common/errors/app.exception';
import {
  FiliaisScopeService,
  parseFiliaisParam,
} from '../../src/common/tenant/filiais-scope.service';

/**
 * Recorte por filial (doc 07 §4.2). O caso perigoso não é o usuário restrito pedindo o que pode —
 * é o que pede o que não pode, e o que não pede nada.
 */
describe('FiliaisScopeService', () => {
  const scope = new FiliaisScopeService();

  describe('sem restrição (allowlist vazia = todas)', () => {
    it('sem parâmetro, não filtra nada', () => {
      expect(scope.resolve([])).toEqual({ filiais: null });
      expect(scope.whereClause({ filiais: null })).toBeUndefined();
    });

    it('com parâmetro, filtra pelo que foi pedido', () => {
      expect(scope.resolve([], [2, 5])).toEqual({ filiais: [2, 5] });
      expect(scope.whereClause({ filiais: [2, 5] })).toEqual({ in: [2, 5] });
    });
  });

  describe('com restrição', () => {
    it('sem parâmetro, devolve exatamente o recorte da membership', () => {
      expect(scope.resolve([1, 2])).toEqual({ filiais: [1, 2] });
    });

    it('com parâmetro dentro do recorte, restringe ainda mais', () => {
      expect(scope.resolve([1, 2, 3], [2])).toEqual({ filiais: [2] });
    });

    it('remove duplicatas do pedido', () => {
      expect(scope.resolve([1, 2], [1, 1, 2])).toEqual({ filiais: [1, 2] });
    });

    it('pedir filial fora do recorte é 403 — não lista vazia', () => {
      expect.assertions(2);
      try {
        scope.resolve([1, 2], [3]);
      } catch (error) {
        const appError = error as AppException;
        expect(appError.code).toBe('FORBIDDEN');
        expect(appError.logContext).toMatchObject({ requested: [3], allowed: [1, 2] });
      }
    });

    it('basta uma filial proibida no meio de permitidas para recusar tudo', () => {
      expect(() => scope.resolve([1, 2], [1, 2, 9])).toThrow();
    });
  });
});

describe('parseFiliaisParam', () => {
  it('aceita lista de inteiros', () => {
    expect(parseFiliaisParam('1,2,10')).toEqual([1, 2, 10]);
    expect(parseFiliaisParam(' 3 , 4 ')).toEqual([3, 4]);
  });

  it('trata ausência e vazio como "sem filtro"', () => {
    expect(parseFiliaisParam(undefined)).toBeUndefined();
    expect(parseFiliaisParam('')).toBeUndefined();
    expect(parseFiliaisParam('   ')).toBeUndefined();
  });

  it.each([
    ['texto', 'abc'],
    ['injeção', '1;DROP TABLE erp_filiais'],
    ['negativo', '-1'],
    ['zero', '0'],
    ['decimal', '1.5'],
    ['vírgula solta', '1,,2'],
  ])('recusa %s', (_caso, entrada) => {
    expect(() => parseFiliaisParam(entrada)).toThrow();
  });

  it('recusa lista absurdamente grande (consumo — API4)', () => {
    const gigante = Array.from({ length: 201 }, (_, indice) => indice + 1).join(',');
    expect(() => parseFiliaisParam(gigante)).toThrow();
  });
});
