import { ROLES } from '@dashsgs/shared';
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
