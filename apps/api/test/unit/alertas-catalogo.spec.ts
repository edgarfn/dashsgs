import {
  ALERT_SEVERITIES,
  ALERT_TYPES,
  ALERT_TYPES_DISPONIVEIS,
  ALERT_TYPE_INFO,
  SEVERIDADE_PESO,
  isAlertType,
} from '@dashsgs/shared';
import { AVALIADORES } from '../../src/modules/alertas/avaliadores';

/**
 * Catálogo de alertas × avaliadores.
 *
 * O teste existe para impedir uma promessa falsa: um tipo marcado como disponível **precisa** ter
 * quem o avalie, senão a tela mostra o aviso ligado e nada acontece — o pior defeito possível num
 * produto cujo valor é avisar (doc 15 §8).
 */
describe('catálogo de alertas', () => {
  it('todo tipo tem rótulo, descrição e severidade válida', () => {
    for (const tipo of ALERT_TYPES) {
      const info = ALERT_TYPE_INFO[tipo];

      expect(info.label.length).toBeGreaterThan(3);
      expect(info.descricao.length).toBeGreaterThan(20);
      expect(ALERT_SEVERITIES).toContain(info.severidadePadrao);
      expect(['operacao', 'administracao']).toContain(info.audienciaPadrao);
    }
  });

  it('tipo disponível tem avaliador; tipo indisponível explica o que falta', () => {
    for (const tipo of ALERT_TYPES) {
      const info = ALERT_TYPE_INFO[tipo];

      if (info.disponivel) {
        expect({ tipo, temAvaliador: Boolean(AVALIADORES[tipo]) }).toEqual({
          tipo,
          temAvaliador: true,
        });
      } else {
        expect({ tipo, dependencia: info.dependencia ?? null }).not.toEqual({
          tipo,
          dependencia: null,
        });
        // E não pode ter avaliador: seria disponível, e o catálogo estaria mentindo.
        expect(AVALIADORES[tipo]).toBeUndefined();
      }
    }
  });

  it('a lista de disponíveis bate com o catálogo', () => {
    const esperados = ALERT_TYPES.filter((tipo) => ALERT_TYPE_INFO[tipo].disponivel);
    expect([...ALERT_TYPES_DISPONIVEIS]).toEqual([...esperados]);
    expect(ALERT_TYPES_DISPONIVEIS.length).toBeGreaterThanOrEqual(5);
  });

  it('os limiares padrão são números utilizáveis', () => {
    for (const tipo of ALERT_TYPES) {
      for (const [campo, valor] of Object.entries(ALERT_TYPE_INFO[tipo].parametrosPadrao)) {
        expect({ tipo, campo, finito: Number.isFinite(valor), negativo: valor < 0 }).toEqual({
          tipo,
          campo,
          finito: true,
          negativo: false,
        });
      }
    }
  });

  it('a ordem de severidade coloca o que exige ação primeiro', () => {
    expect(SEVERIDADE_PESO.critica).toBeLessThan(SEVERIDADE_PESO.alta);
    expect(SEVERIDADE_PESO.alta).toBeLessThan(SEVERIDADE_PESO.media);
    expect(SEVERIDADE_PESO.media).toBeLessThan(SEVERIDADE_PESO.baixa);
  });

  it('reconhece tipo válido e recusa inventado', () => {
    expect(isAlertType('ruptura_curva_a')).toBe(true);
    expect(isAlertType('estoque_fantasma')).toBe(false);
  });
});
