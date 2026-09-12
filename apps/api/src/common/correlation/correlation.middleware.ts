import { CORRELATION_ID_HEADER } from '@dashsgs/shared';
import type { NextFunction, Request, Response } from 'express';
import { runWithCorrelation, sanitizeCorrelationId } from './correlation.context';

/**
 * Middleware de borda: estabelece o id de correlação antes de qualquer outro middleware
 * (inclusive o do logger), devolve-o no header da resposta e abre o contexto assíncrono.
 *
 * Registrado em `main.ts` com `app.use(...)` para garantir que seja o primeiro da pilha.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = sanitizeCorrelationId(req.headers[CORRELATION_ID_HEADER]);

  // Disponível para o pino-http (genReqId) e para o filtro de exceções.
  (req as Request & { correlationId?: string }).correlationId = correlationId;
  res.setHeader(CORRELATION_ID_HEADER, correlationId);

  runWithCorrelation({ correlationId }, () => next());
}
