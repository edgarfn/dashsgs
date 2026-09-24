import 'server-only';

/**
 * Log estruturado do servidor do Next (BFF).
 *
 * A API tem pino; o Next não tinha nada — falha de rede entre Next e API sumia sem deixar rastro,
 * e a tela mostrava um erro genérico que ninguém conseguia investigar depois. Uma linha JSON por
 * evento, no mesmo formato do logger da API (doc 18 §1), para que `docker compose logs` fique
 * homogêneo e o `correlation_id` amarre os dois lados.
 *
 * Só entra aqui o que ajuda a investigar: método, rota, status, tempo e causa. Nada de corpo de
 * requisição, cookie ou credencial — esta função é chamada em caminho de erro, justamente onde é
 * mais fácil vazar dado sem querer.
 */

const NIVEL_PINO = { warn: 40, error: 50 } as const;

export function logServidor(nivel: keyof typeof NIVEL_PINO, dados: Record<string, unknown>): void {
  // eslint-disable-next-line no-console -- único ponto de saída de log do BFF (doc 18 §1).
  console.error(
    JSON.stringify({
      level: NIVEL_PINO[nivel],
      ts: new Date().toISOString(),
      service: 'dashsgs-web',
      ...dados,
    }),
  );
}
