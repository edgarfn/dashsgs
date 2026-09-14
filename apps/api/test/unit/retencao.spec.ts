import { POLITICAS, calcularCorte, descreverPrazo } from '../../src/modules/retencao/politicas';

/**
 * O catálogo de retenção (doc 10 §2) é a matriz de privacidade em forma executável. Estes testes
 * cuidam das propriedades que, se quebrarem, quebram em silêncio: id repetido some do painel,
 * identificador estranho vira SQL montado à mão, e prazo em "dias" para o que a lei conta em
 * meses erra o corte alguns dias por ano — sempre para o lado de guardar demais.
 */
describe('catálogo de retenção', () => {
  it('não tem id repetido — o id entra em métrica e em relatório', () => {
    const ids = POLITICAS.map((politica) => politica.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('só nomeia tabela e coluna com identificador simples', () => {
    const invalidas = POLITICAS.filter(
      (politica) =>
        !/^[a-z][a-z0-9_]*$/.test(politica.tabela) || !/^[a-z][a-z0-9_]*$/.test(politica.coluna),
    );
    expect(invalidas).toEqual([]);
  });

  it('toda política diz de onde veio e por quê', () => {
    const semJustificativa = POLITICAS.filter(
      (politica) => politica.origem.length < 5 || politica.motivo.length < 20,
    ).map((politica) => politica.id);
    expect(semJustificativa).toEqual([]);
  });

  it('cobre o que a matriz do doc 10 §2 promete apagar', () => {
    const tabelas = POLITICAS.map((politica) => politica.tabela);
    for (const esperada of [
      'app_sessions',
      'app_audit_log',
      'app_users',
      'sync_api_call_log',
      'erp_vendas_cupons',
      'erp_venda_itens',
      'erp_contas_pagar',
      'erp_despesas',
      'erp_cartao_vendas',
    ]) {
      expect(tabelas).toContain(esperada);
    }
  });
});

describe('corte de retenção', () => {
  it('conta mês em calendário, não em múltiplos de 30 dias', () => {
    // 26 meses antes de 31/03/2026 é 31/01/2024. Em "dias", daria quase uma semana de diferença —
    // e o produto passaria a guardar detalhe de venda além do que prometeu.
    const corte = calcularCorte({ mesesDoTenant: true }, new Date('2026-03-31T12:00:00Z'), 26);
    expect(corte.toISOString().slice(0, 10)).toBe('2024-01-31');
  });

  it('dias são dias', () => {
    const corte = calcularCorte({ dias: 30 }, new Date('2026-03-31T12:00:00Z'), 26);
    expect(corte.toISOString().slice(0, 10)).toBe('2026-03-01');
  });

  it('o prazo configurável do tenant manda no corte de vendas', () => {
    const curto = calcularCorte({ mesesDoTenant: true }, new Date('2026-03-31T12:00:00Z'), 12);
    expect(curto.toISOString().slice(0, 10)).toBe('2025-03-31');
  });

  it('descreve o prazo do jeito que o painel mostra', () => {
    expect(descreverPrazo({ dias: 90 }, 26)).toBe('90 dias');
    expect(descreverPrazo({ meses: 60 }, 26)).toBe('5 ano(s)');
    expect(descreverPrazo({ mesesDoTenant: true }, 26)).toBe('26 meses');
  });
});
