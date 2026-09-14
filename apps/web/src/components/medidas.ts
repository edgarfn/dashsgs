/**
 * Medida de barra como classe, nunca como atributo `style` (E9-02).
 *
 * O motivo está em `app/globals.css`: a CSP de produção não abre exceção para inline, e
 * `style-src` também cobre o atributo `style` — a declaração é descartada em silêncio e a barra
 * fica com 0px. Estas funções são o único caminho para dizer "esta barra vale 42%".
 *
 * Servem tanto a componente de servidor quanto a componente de cliente: é folha de estilo
 * estática, não depende do nonce da requisição.
 */

/** Percentual (0–100) na classe correspondente, arredondado ao inteiro. */
export function classeMedida(percentual: number): string {
  const inteiro = Number.isFinite(percentual) ? Math.round(percentual) : 0;
  return `medida-${Math.min(100, Math.max(0, inteiro))}`;
}

/**
 * Classe da barra de `valor` contra o `maximo` da série.
 *
 * `minimo` é o piso em pontos percentuais: sem ele, um valor pequeno mas real desenha uma barra
 * de 0px — indistinguível de "não veio dado". Valor zero continua zerado, que é o correto.
 */
export function classeProporcao(valor: number, maximo: number, minimo = 2): string {
  if (!Number.isFinite(valor) || valor <= 0) return classeMedida(0);
  return classeMedida(Math.max(minimo, maximo > 0 ? (valor / maximo) * 100 : 0));
}
