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
    /**
     * Prefixo aplicado a TODAS as rotas (doc 34 Q5).
     *
     * A SG não confirmou se o `/public` do SG Cloud vale só para a autorização ou para a API
     * inteira. Vazio mantém o comportamento observado na homologação; `/public` aqui cobre o
     * outro cenário sem tocar em código.
     */
    apiPathPrefix: z
      .string()
      .trim()
      .max(60)
      .regex(/^(\/[A-Za-z0-9._~-]+)*$/, 'use um prefixo de caminho, ex.: /public')
      .optional(),
    /**
     * Formato do header Authorization (doc 34 Q2).
     *
     * O cliente descobre sozinho no primeiro 401 e grava o que funcionou; este campo serve para
     * o operador fixar o valor quando já souber, poupando o 401 de aprendizado.
     */
    authHeaderMode: z.enum(['raw', 'bearer']).optional(),
    /**
     * Itens por página pedidos à API (doc 34 Q4). Ausente = padrão da instalação.
     *
     * O teto real por endpoint é a pergunta aberta; quando um endpoint recusa o tamanho, o
     * cliente reduz sozinho e grava o que passou.
     */
    pageSize: z.coerce.number().int().min(10).max(5000).optional(),
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
