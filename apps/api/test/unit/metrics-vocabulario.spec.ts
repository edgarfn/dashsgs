import { VOCABULARIO_METRICAS } from '../../src/common/metrics/metrics.service';
import { SG_FALHAS } from '../../src/integration/sg/sg-errors';

/**
 * O vocabulário de rótulos (`metrics.service.ts`) é o contrato que as regras do Prometheus
 * casam — `scripts/check-observability.mjs` reprova o CI quando um alerta usa valor que não
 * está nele. Isso só protege enquanto o vocabulário disser a verdade sobre o que o código
 * emite; é o que estes testes fixam.
 *
 * Por que não importar `SG_FALHAS` direto no `metrics.service.ts`: `common/` não depende de
 * `integration/`. A cópia é deliberada, e o preço dela é este teste.
 */
describe('vocabulário de métricas', () => {
  it('cobre todas as falhas classificadas da SG', () => {
    const declarados = VOCABULARIO_METRICAS.sg_token_refresh_total?.result ?? [];

    for (const falha of SG_FALHAS) {
      expect(declarados).toContain(falha);
    }
  });

  it('não declara valor de falha da SG que o cliente não produz mais', () => {
    const declarados = VOCABULARIO_METRICAS.sg_token_refresh_total?.result ?? [];
    // `ok` e `erro` não são `SgFalha`: são o sucesso e o escape de classificação do
    // SgTokenManager. Todo o resto tem que existir no vocabulário do cliente SG.
    const extras = declarados.filter(
      (valor) => valor !== 'ok' && valor !== 'erro' && !SG_FALHAS.includes(valor as never),
    );

    expect(extras).toEqual([]);
  });

  it('descreve apenas rótulos de cardinalidade fechada', () => {
    // `tenant`, `route`, `endpoint`, `queue` e `policy` são abertos por natureza: listá-los
    // aqui faria o gate reprovar um tenant novo — exatamente o oposto do que ele serve.
    const abertos = ['tenant', 'route', 'endpoint', 'queue', 'policy', 'domain'];

    for (const [metrica, rotulos] of Object.entries(VOCABULARIO_METRICAS)) {
      for (const rotulo of Object.keys(rotulos)) {
        expect({ metrica, rotulo, aberto: abertos.includes(rotulo) }).toMatchObject({
          aberto: false,
        });
      }
    }
  });
});
