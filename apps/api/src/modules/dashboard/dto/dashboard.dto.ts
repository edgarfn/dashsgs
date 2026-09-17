import { z } from 'zod';

/**
 * Filtros do dashboard (doc 15 §"Filtros globais" / doc 16 §4).
 *
 * Todos chegam pela URL para que um link possa ser compartilhado com o contexto inteiro — é o
 * que o doc 16 pede, e é também o que torna cada tela cacheável por chave estável.
 */

const dia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD')
  .refine((valor) => !Number.isNaN(Date.parse(`${valor}T00:00:00Z`)), 'data inexistente');

/** `?filiais=1,2,3`; ausência = todas as que a membership permite. */
const filiais = z.string().optional();

/**
 * Qual dos cinco custos do ERP entra no cálculo de margem (doc 15 §1).
 *
 * É escolha de negócio, não detalhe técnico: redes que compram com verba usam o custo com
 * encargos; quem acompanha reposição usa o médio. O padrão é o médio, que é o mais comparável.
 */
export const CUSTOS = ['medio', 'real', 'com_encargos', 'fiscal_medio', 'sem_icms'] as const;
export type BaseDeCusto = (typeof CUSTOS)[number];

export const homeQuerySchema = z
  .object({
    filiais,
    custo: z.enum(CUSTOS).default('medio'),
  })
  .strict();
export type HomeQuery = z.infer<typeof homeQuerySchema>;

export const vendasDiaQuerySchema = z
  .object({
    data: dia,
    filiais,
    caixa: z.coerce.number().int().min(0).optional(),
    /** `true` mostra só cupons cancelados; `false`, só os válidos; ausente, todos. */
    canceladas: z.enum(['true', 'false']).optional(),
    pagina: z.coerce.number().int().min(1).default(1),
    itensPorPagina: z.coerce.number().int().min(10).max(200).default(50),
  })
  .strict();
export type VendasDiaQuery = z.infer<typeof vendasDiaQuerySchema>;

export const comparativoQuerySchema = z
  .object({
    de: dia,
    ate: dia,
    filiais,
    custo: z.enum(CUSTOS).default('medio'),
  })
  .strict()
  .refine((valor) => valor.de <= valor.ate, {
    message: 'o início do período precisa vir antes do fim',
    path: ['de'],
  })
  // Um ano por consulta: acima disso a série deixa de caber num gráfico legível e o custo da
  // query cresce sem ninguém olhar o resultado.
  .refine(
    (valor) =>
      (Date.parse(`${valor.ate}T00:00:00Z`) - Date.parse(`${valor.de}T00:00:00Z`)) / 86_400_000 <=
      366,
    { message: 'período máximo de 366 dias', path: ['ate'] },
  );
export type ComparativoQuery = z.infer<typeof comparativoQuerySchema>;

/** Financeiro e Compras compartilham o filtro: período + filiais. */
export const periodoQuerySchema = z
  .object({
    de: dia,
    ate: dia,
    filiais,
  })
  .strict()
  .refine((valor) => valor.de <= valor.ate, {
    message: 'o início do período precisa vir antes do fim',
    path: ['de'],
  })
  .refine(
    (valor) =>
      (Date.parse(`${valor.ate}T00:00:00Z`) - Date.parse(`${valor.de}T00:00:00Z`)) / 86_400_000 <=
      366,
    { message: 'período máximo de 366 dias', path: ['ate'] },
  );
export type PeriodoQuery = z.infer<typeof periodoQuerySchema>;

/**
 * Metas (doc 15 §7). A competência é `AAAA-MM` e não um par de datas: previsão é lançada por mês
 * no ERP, e aceitar um intervalo arbitrário convidaria a somar metade de dois meses.
 */
export const metasQuerySchema = z
  .object({
    filiais,
    competencia: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use o formato AAAA-MM')
      .optional(),
  })
  .strict();
export type MetasQuery = z.infer<typeof metasQuerySchema>;

export const rupturaQuerySchema = z
  .object({
    filiais,
    /** Curva ABC do produto: focar em A é o que transforma a lista em ação (doc 15 §4). */
    curva: z.enum(['A', 'B', 'C']).optional(),
    situacao: z.enum(['ruptura', 'negativo', 'excesso']).default('ruptura'),
    pagina: z.coerce.number().int().min(1).default(1),
    itensPorPagina: z.coerce.number().int().min(10).max(200).default(50),
  })
  .strict();
export type RupturaQuery = z.infer<typeof rupturaQuerySchema>;
