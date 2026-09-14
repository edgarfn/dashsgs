import { ALERT_SEVERITIES, ALERT_STATUSES } from '@dashsgs/shared';
import { z } from 'zod';

/** Filtros do feed (doc 16 §2 "Alertas — Feed": lista com severidade, filtros, ack em massa). */
export const feedQuerySchema = z
  .object({
    status: z.enum(ALERT_STATUSES).optional(),
    severidade: z.enum(ALERT_SEVERITIES).optional(),
    filialErpId: z.coerce.number().int().min(1).optional(),
    pagina: z.coerce.number().int().min(1).default(1),
    itensPorPagina: z.coerce.number().int().min(5).max(100).default(25),
  })
  .strict();
export type FeedQuery = z.infer<typeof feedQuerySchema>;

/**
 * Ajuste de regra. Trocar o tipo não faz sentido (é ele que define o avaliador), então só o que
 * é configurável entra: ligar/desligar, severidade, canal e limiares.
 */
export const regraUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    severity: z.enum(ALERT_SEVERITIES).optional(),
    canalEmail: z.boolean().optional(),
    params: z.record(z.coerce.number()).optional(),
  })
  .strict()
  .refine((valor) => Object.keys(valor).length > 0, { message: 'nada para alterar' });
export type RegraUpdateInput = z.infer<typeof regraUpdateSchema>;
