import { z } from 'zod';

/**
 * Normalizações obrigatórias da camada anticorrupção (doc 12 §4).
 *
 * A API SG carrega marcas de um ERP antigo: id com padding de espaços (`"5 "`), data vazia como
 * `""` em vez de null, pseudo-booleano em char (`" "`, `"S"`), número ora int ora float. Nada
 * disso pode vazar para dentro do produto — o resto do sistema só vê tipos limpos.
 */

/** `"5 "` → `"5"`. Ids e códigos string SEMPRE passam por aqui (doc 03, observação 3). */
export const sgId = z
  .union([z.string(), z.number()])
  .transform((valor) => String(valor).trim())
  .pipe(z.string().min(1));

/** Texto livre: aparado, com vazio virando null. */
export const sgTexto = (max = 255) =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((valor) => {
      if (valor === null || valor === undefined) return null;
      const texto = String(valor).trim();
      return texto === '' ? null : texto.slice(0, max);
    });

/** Data `YYYY-MM-DD`; `""` e `"0000-00-00"` viram null (doc 12 §4.3). */
export const sgData = z
  .union([z.string(), z.null()])
  .optional()
  .transform((valor) => {
    if (!valor) return null;
    const texto = valor.trim();
    if (texto === '' || texto.startsWith('0000-00-00')) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
  });

/** Hora `HH:MM` (sem timezone na origem — o fuso é o da loja, doc 34 Q12). */
export const sgHora = z
  .union([z.string(), z.null()])
  .optional()
  .transform((valor) => {
    if (!valor) return null;
    const match = /^(\d{1,2}):(\d{2})/.exec(valor.trim());
    if (!match) return null;
    return `${match[1]!.padStart(2, '0')}:${match[2]}`;
  });

/**
 * Número que pode chegar como int, float ou string com vírgula decimal.
 *
 * O valor fica como number aqui só para trafegar; dinheiro vira `numeric`/centavos na
 * persistência (doc 12 §4.4) — float binário não é moeda.
 */
export const sgNumero = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((valor) => {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
    const normalizado = valor
      .trim()
      .replace(/\.(?=\d{3}\b)/g, '')
      .replace(',', '.');
    const numero = Number(normalizado);
    return Number.isFinite(numero) ? numero : null;
  });

export const sgInteiro = sgNumero.transform((valor) => (valor === null ? null : Math.trunc(valor)));

/**
 * Pseudo-booleano: `true`, `"S"`, `"1"`, `"true"` são verdadeiros; `" "`, `""`, `"N"`, null são
 * falsos (doc 02 §4.5). Qualquer outro char cai em falso — o campo é binário na origem.
 */
export const sgBooleano = z
  .union([z.boolean(), z.string(), z.number(), z.null()])
  .optional()
  .transform((valor) => {
    if (typeof valor === 'boolean') return valor;
    if (typeof valor === 'number') return valor !== 0;
    if (!valor) return false;
    return ['s', 'sim', '1', 'true', 't', 'y'].includes(valor.trim().toLowerCase());
  });

/**
 * Char-flag → enum tipado (doc 12 §4.2).
 * Valor desconhecido não explode a página: vira `desconhecido`, e a linha continua utilizável.
 */
export function sgEnum<T extends string>(mapa: Record<string, T>, padrao: T) {
  return z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((valor) => {
      if (valor === null || valor === undefined) return padrao;
      const chave = String(valor).trim().toUpperCase();
      return mapa[chave] ?? mapa[chave.charAt(0)] ?? padrao;
    });
}

/** Situação de registro (doc 12 §4.2). */
export const SITUACAO = {
  '': 'normal',
  C: 'cancelada',
  P: 'pendente',
  A: 'atendida',
  X: 'excluida',
} as const;

/** `tipoEntidade`: ora código, ora por extenso (doc 02 §4.3). */
export const TIPO_ENTIDADE: Record<string, 'cliente' | 'fornecedor' | 'filial'> = {
  C: 'cliente',
  CLIENTE: 'cliente',
  F: 'fornecedor',
  FORNECEDOR: 'fornecedor',
  E: 'filial',
  FILIAL: 'filial',
  EMPRESA: 'filial',
};

export const sgTipoEntidade = sgEnum(TIPO_ENTIDADE, 'cliente');

/**
 * Envelope de paginação — a API usa `paginacao`, `ordenacao` ou array puro, dependendo do
 * endpoint (doc 02 §3). O cliente HTTP trata os três como a mesma coisa.
 */
export interface PaginaNormalizada<T> {
  itens: T[];
  pagina: number;
  itensPorPagina: number;
  quantidadePaginas: number;
  quantidadeItens: number;
}

const envelopeSchema = z
  .object({
    pagina: z.coerce.number().int().optional(),
    itensPorPagina: z.coerce.number().int().optional(),
    quantidadePaginas: z.coerce.number().int().optional(),
    quantidadeItens: z.coerce.number().int().optional(),
  })
  .passthrough();

/**
 * Extrai itens e metadados de qualquer um dos três formatos.
 *
 * `chaveItens` existe porque a lista nem sempre se chama "dados": cada módulo batizou a sua
 * (`produtos`, `vendas`, `filiais`...). Procuramos a chave informada e, se não houver, o primeiro
 * array do objeto.
 */
export function normalizarPagina<T>(corpo: unknown, chaveItens?: string): PaginaNormalizada<T> {
  if (Array.isArray(corpo)) {
    return {
      itens: corpo as T[],
      pagina: 1,
      itensPorPagina: corpo.length,
      quantidadePaginas: 1,
      quantidadeItens: corpo.length,
    };
  }

  if (!corpo || typeof corpo !== 'object') {
    return { itens: [], pagina: 1, itensPorPagina: 0, quantidadePaginas: 1, quantidadeItens: 0 };
  }

  const objeto = corpo as Record<string, unknown>;
  const envelope = envelopeSchema.parse(objeto.paginacao ?? objeto.ordenacao ?? objeto);

  const itens = encontrarLista<T>(objeto, chaveItens);
  const itensPorPagina = envelope.itensPorPagina ?? itens.length;
  const quantidadeItens = envelope.quantidadeItens ?? itens.length;

  return {
    itens,
    pagina: envelope.pagina ?? 1,
    itensPorPagina,
    quantidadePaginas:
      envelope.quantidadePaginas ??
      (itensPorPagina > 0 ? Math.max(1, Math.ceil(quantidadeItens / itensPorPagina)) : 1),
    quantidadeItens,
  };
}

function encontrarLista<T>(objeto: Record<string, unknown>, chaveItens?: string): T[] {
  if (chaveItens && Array.isArray(objeto[chaveItens])) return objeto[chaveItens] as T[];

  for (const [chave, valor] of Object.entries(objeto)) {
    if (chave === 'paginacao' || chave === 'ordenacao') continue;
    if (Array.isArray(valor)) return valor as T[];
  }

  return [];
}
