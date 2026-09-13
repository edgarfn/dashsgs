import { SYNC_DOMAINS } from '@dashsgs/shared';
import { z } from 'zod';

/** Re-sincronização pedida na tela (doc 26 §Status: botão "Ressincronizar período"). */
export const resyncSchema = z
  .object({
    domain: z.enum(SYNC_DOMAINS).refine((valor) => valor !== 'backfill', {
      message: 'Carga histórica tem endpoint próprio.',
    }),
    filialErpId: z.coerce.number().int().min(0).optional(),
    /** Dia alvo; ausente = o job decide pela marca d'água. */
    data: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD')
      .optional(),
  })
  .strict();

export type ResyncInput = z.infer<typeof resyncSchema>;

/**
 * Carga histórica. O teto de 800 dias (~26 meses) é o contratado no doc 14 §3; acima disso o
 * custo de chamadas deixa de ser diluível em janelas noturnas.
 */
export const backfillSchema = z
  .object({
    dias: z.coerce.number().int().min(1).max(800).default(90),
    filiais: z.array(z.coerce.number().int().min(1)).max(50).optional(),
  })
  .strict();

export type BackfillInput = z.infer<typeof backfillSchema>;
