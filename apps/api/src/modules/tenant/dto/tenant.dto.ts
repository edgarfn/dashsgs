import {
  AUDIT_CATEGORIAS,
  AUDIT_RESULTADOS,
  PAGE_DEFAULT,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  ROLES,
} from '@dashsgs/shared';
import { z } from 'zod';

/** Alteração de vínculo: pelo menos um campo, e nada além dos dois declarados. */
export const memberUpdateSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    /** Vazio = todas as filiais do tenant (doc 05 §1). */
    filiaisAllowed: z.array(z.number().int().positive()).max(200).optional(),
  })
  .strict()
  .refine((value) => value.role !== undefined || value.filiaisAllowed !== undefined, {
    message: 'informe role ou filiaisAllowed',
  });
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;

/** `?filiais=1,2` — validado contra `filiais_allowed` no serviço (doc 23). */
export const filiaisQuerySchema = z
  .object({ filiais: z.string().trim().max(1200).optional() })
  .strict();
export type FiliaisQueryInput = z.infer<typeof filiaisQuerySchema>;

/**
 * Filtros da trilha de auditoria (doc 16 §2 / E6-01).
 *
 * `.strict()` como em todo o resto: filtro que a API não conhece vira 422, e não uma consulta
 * silenciosamente mais ampla do que o auditor pediu.
 */
const diaIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD')
  .refine((valor) => !Number.isNaN(Date.parse(`${valor}T00:00:00Z`)), 'data inexistente');

export const auditQuerySchema = z
  .object({
    de: diaIso.optional(),
    ate: diaIso.optional(),
    /** Código exato do catálogo (`auth.login.failed`). */
    acao: z.string().trim().max(80).optional(),
    categoria: z.enum(AUDIT_CATEGORIAS).optional(),
    resultado: z.enum(AUDIT_RESULTADOS).optional(),
    atorId: z.string().uuid().optional(),
    recursoTipo: z.string().trim().max(60).optional(),
    page: z.coerce.number().int().min(1).default(PAGE_DEFAULT),
    pageSize: z.coerce.number().int().min(10).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  })
  .strict()
  .refine((valor) => !valor.de || !valor.ate || valor.de <= valor.ate, {
    message: 'o início do período precisa vir antes do fim',
    path: ['de'],
  });
export type AuditQueryInput = z.infer<typeof auditQuerySchema>;

/** O export usa os mesmos filtros, sem paginação: o arquivo é o período inteiro. */
export const auditExportQuerySchema = auditQuerySchema.innerType().omit({
  page: true,
  pageSize: true,
});
export type AuditExportQueryInput = z.infer<typeof auditExportQuerySchema>;
