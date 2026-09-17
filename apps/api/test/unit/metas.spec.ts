import {
  fimDoMes,
  fracaoPorCurva,
  montarCurva,
  percentual,
} from '../../src/modules/dashboard/metas.service';

/**
 * A aritmética da tela de metas (doc 15 §7 / E7-03).
 *
 * Todo número desta tela é uma divisão, e divisão é onde moram os defeitos silenciosos: o mês
 * que ainda não começou, a meta zerada, a curva que cobre metade do mês. Nenhum deles derruba a
 * página — todos produzem um número errado com cara de certo, que é pior.
 */
describe('metas — fração decorrida', () => {
  it('usa a curva quando ela cobre o mês', () => {
    // 40% do previsto do mês já deveria ter sido vendido.
    expect(fracaoPorCurva(400, 1_000)).toBeCloseTo(0.4);
  });

  it('nunca passa de 1', () => {
    // Fim do mês com arredondamento acumulado: a fração não pode virar 1,02 e deflacionar a
    // projeção justamente no dia em que ela deveria ser exata.
    expect(fracaoPorCurva(1_010, 1_000)).toBe(1);
  });

  it('devolve zero quando não há curva — e não NaN', () => {
    expect(fracaoPorCurva(undefined, undefined)).toBe(0);
    expect(fracaoPorCurva(100, 0)).toBe(0);
  });
});

describe('metas — percentual', () => {
  it('arredonda para uma casa', () => {
    expect(percentual(333, 1_000)).toBe(33.3);
  });

  it('meta zerada devolve zero em vez de infinito', () => {
    // Filial cadastrada sem previsão: mostrar "∞% da meta" seria pior que mostrar 0%.
    expect(percentual(500, 0)).toBe(0);
  });
});

describe('metas — curva acumulada', () => {
  const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it('acumula previsto e realizado no mesmo eixo', () => {
    const curva = montarCurva(
      [
        { data: dia('2026-09-01'), previsto: 100 },
        { data: dia('2026-09-02'), previsto: 150 },
        { data: dia('2026-09-03'), previsto: 120 },
      ],
      [
        { data: dia('2026-09-01'), realizado: 90 },
        { data: dia('2026-09-02'), realizado: 160 },
      ],
    );

    expect(curva.map((ponto) => ponto.previsto)).toEqual([100, 250, 370]);
    // O realizado para no último dia com dado: o dia 3 ainda não aconteceu, e desenhar 250 ali
    // faria a linha do realizado parecer estagnada em vez de ausente.
    expect(curva.map((ponto) => ponto.realizado)).toEqual([90, 250, 0]);
  });

  it('soma as filiais do mesmo dia', () => {
    const curva = montarCurva(
      [
        { data: dia('2026-09-01'), previsto: 100 },
        { data: dia('2026-09-01'), previsto: 40 },
      ],
      [{ data: dia('2026-09-01'), realizado: 130 }],
    );

    expect(curva).toEqual([{ data: '2026-09-01', previsto: 140, realizado: 130 }]);
  });

  it('sem realizado nenhum, a linha prevista continua de pé', () => {
    const curva = montarCurva([{ data: dia('2026-10-01'), previsto: 500 }], []);
    expect(curva).toEqual([{ data: '2026-10-01', previsto: 500, realizado: 0 }]);
  });
});

describe('metas — fim do mês', () => {
  it('conhece meses de 30, 31 e 28 dias', () => {
    expect(fimDoMes('2026-09')).toBe('2026-09-30');
    expect(fimDoMes('2026-10')).toBe('2026-10-31');
    expect(fimDoMes('2026-02')).toBe('2026-02-28');
  });

  it('acerta fevereiro de ano bissexto', () => {
    // 2028 é bissexto: contar 28 dias fixos perderia um dia de venda na projeção do mês.
    expect(fimDoMes('2028-02')).toBe('2028-02-29');
  });
});
