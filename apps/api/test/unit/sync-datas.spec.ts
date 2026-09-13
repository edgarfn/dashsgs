import { fatiar } from '../../src/modules/sync/domains/resumo-filial.sync';
import { diaEm, diferencaEmDias, somarDias } from '../../src/modules/sync/sync.types';

/**
 * Aritmética de datas do sync.
 *
 * Parece trivial até o dia em que o horário de verão volta, ou até um tenant de Manaus pedir "as
 * vendas de hoje" às 22h e receber as de ontem. Cada caso abaixo é um desses.
 */
describe('somarDias', () => {
  it('anda para frente e para trás sem passar por fuso', () => {
    expect(somarDias('2026-09-13', 1)).toBe('2026-09-14');
    expect(somarDias('2026-09-13', -1)).toBe('2026-09-12');
  });

  it('atravessa virada de mês e de ano', () => {
    expect(somarDias('2026-09-30', 1)).toBe('2026-10-01');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('respeita ano bissexto', () => {
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(somarDias('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('não escorrega no fim do horário de verão', () => {
    // O Brasil não adota mais, mas a série histórica atravessa períodos em que adotava, e o
    // cálculo por UTC precisa continuar dando exatamente um dia.
    expect(somarDias('2018-02-17', 1)).toBe('2018-02-18');
    expect(somarDias('2018-11-04', 1)).toBe('2018-11-05');
  });
});

describe('diferencaEmDias', () => {
  it('conta a distância entre duas datas', () => {
    expect(diferencaEmDias('2026-09-01', '2026-09-30')).toBe(29);
    expect(diferencaEmDias('2026-09-30', '2026-09-01')).toBe(-29);
    expect(diferencaEmDias('2026-09-13', '2026-09-13')).toBe(0);
  });
});

describe('diaEm', () => {
  it('usa o fuso do tenant, não o do servidor', () => {
    // 2026-09-14T02:30:00Z: já é dia 14 em Londres, ainda é 13 em São Paulo e em Manaus.
    const instante = new Date('2026-09-14T02:30:00Z');

    expect(diaEm(instante, 'America/Sao_Paulo')).toBe('2026-09-13');
    expect(diaEm(instante, 'America/Manaus')).toBe('2026-09-13');
    expect(diaEm(instante, 'UTC')).toBe('2026-09-14');
  });

  it('vira o dia na hora certa de cada praça', () => {
    // 03:30Z = 00:30 em São Paulo (já virou) e 23:30 em Manaus (ainda não).
    const instante = new Date('2026-09-14T03:30:00Z');

    expect(diaEm(instante, 'America/Sao_Paulo')).toBe('2026-09-14');
    expect(diaEm(instante, 'America/Manaus')).toBe('2026-09-13');
  });
});

describe('fatiar', () => {
  it('devolve uma fatia só quando cabe na janela', () => {
    expect(fatiar('2026-09-01', '2026-09-20', 30)).toEqual([
      { inicio: '2026-09-01', fim: '2026-09-20' },
    ]);
  });

  it('quebra períodos longos no limite da API, sem buraco nem sobreposição', () => {
    const fatias = fatiar('2026-01-01', '2026-03-31', 30);

    expect(fatias).toEqual([
      { inicio: '2026-01-01', fim: '2026-01-30' },
      { inicio: '2026-01-31', fim: '2026-03-01' },
      { inicio: '2026-03-02', fim: '2026-03-31' },
    ]);

    // Cada fatia começa exatamente no dia seguinte ao fim da anterior.
    for (let i = 1; i < fatias.length; i += 1) {
      expect(fatias[i]?.inicio).toBe(somarDias(fatias[i - 1]!.fim, 1));
    }
    // E nenhuma passa do limite que a API aceita.
    for (const fatia of fatias) {
      expect(diferencaEmDias(fatia.inicio, fatia.fim) + 1).toBeLessThanOrEqual(30);
    }
  });

  it('não devolve fatia quando o período está invertido', () => {
    expect(fatiar('2026-09-20', '2026-09-01', 30)).toEqual([]);
  });

  it('cobre o dia único', () => {
    expect(fatiar('2026-09-13', '2026-09-13', 30)).toEqual([
      { inicio: '2026-09-13', fim: '2026-09-13' },
    ]);
  });
});
