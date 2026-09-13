/**
 * Geração de CSV para os relatórios tabulares (doc 15 §9 / doc 16 §4).
 *
 * Três decisões que parecem detalhe e não são, porque o arquivo vai ser aberto no Excel em
 * português:
 *
 * - **Separador `;`**: no Excel pt-BR a vírgula é separador decimal; com `,` a planilha abre
 *   tudo numa coluna só.
 * - **BOM UTF-8**: sem ele, acento vira caractere estranho no Excel do Windows.
 * - **Aspas simples antes de `=`, `+`, `-`, `@`**: impede que uma descrição de produto vinda do
 *   ERP seja interpretada como fórmula (injeção de fórmula em CSV — doc 09 §3).
 */

const SEPARADOR = ';';
/** BOM explícito em escape: um caractere invisível no fonte some no primeiro copiar e colar. */
const BOM = String.fromCharCode(0xfeff);
const PERIGOSOS = /^[=+\-@\t\r]/;

export interface ColunaCsv<T> {
  cabecalho: string;
  valor: (linha: T) => string | number | boolean | null | undefined;
}

export function gerarCsv<T>(colunas: Array<ColunaCsv<T>>, linhas: T[]): string {
  const cabecalho = colunas.map((coluna) => escapar(coluna.cabecalho)).join(SEPARADOR);
  const corpo = linhas.map((linha) =>
    colunas.map((coluna) => escapar(formatar(coluna.valor(linha)))).join(SEPARADOR),
  );

  return BOM + [cabecalho, ...corpo].join('\r\n') + '\r\n';
}

/** Número com vírgula decimal: é assim que a planilha pt-BR entende sem reconfiguração. */
function formatar(valor: string | number | boolean | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'boolean') return valor ? 'sim' : 'não';
  if (typeof valor === 'number') {
    return Number.isInteger(valor) ? String(valor) : valor.toFixed(2).replace('.', ',');
  }
  return valor;
}

function escapar(valor: string): string {
  const seguro = PERIGOSOS.test(valor) ? `'${valor}` : valor;

  return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** Nome de arquivo previsível e sem surpresa de encoding no cabeçalho HTTP. */
export function nomeDeArquivo(prefixo: string, ...partes: string[]): string {
  return [prefixo, ...partes]
    .join('-')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .concat('.csv');
}
