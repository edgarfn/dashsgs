import { z } from 'zod';

/**
 * Entrada do wizard de conexão (doc 12 §1 / doc 16 §2 "Admin — Conexão ERP").
 *
 * A senha é opcional na edição: ela nunca é exibida, então quem só ajusta a URL não teria como
 * redigitá-la. Ausente = mantém a que já está no cofre.
 */
export const erpConnectionSchema = z
  .object({
    baseUrl: z.string().trim().min(8).max(255),
    isSgCloud: z.boolean().default(false),
    tlsMode: z.enum(['https', 'vpn']).default('https'),
    username: z.string().trim().min(2).max(120),
    senha: z.string().min(1).max(200).optional(),
    /** Self-rate-limit: conservador por padrão, porque a API SG não documenta limite (doc 34 Q3). */
    maxRps: z.coerce.number().int().min(1).max(20).default(4),
    /** Escape hatch para instalações com caminho de autorização fora do padrão. */
    authPathOverride: z.string().trim().max(255).optional(),
    syncWindowStart: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    syncWindowEnd: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
  })
  .strict();

export type ErpConnectionInput = z.infer<typeof erpConnectionSchema>;
