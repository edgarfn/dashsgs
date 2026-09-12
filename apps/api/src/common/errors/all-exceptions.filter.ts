import {
  CORRELATION_ID_HEADER,
  ERROR_HTTP_STATUS,
  isErrorCode,
  type ApiErrorBody,
  type ErrorCode,
} from '@dashsgs/shared';
import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ZodError } from 'zod';
import { getCorrelationId, sanitizeCorrelationId } from '../correlation/correlation.context';
import { redactObject } from '../logging/redaction';
import { AppException, SAFE_MESSAGES } from './app.exception';

/** Status HTTP nativos do Nest → catálogo interno (doc 23). */
const HTTP_STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'AUTH_REQUIRED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

interface Normalized {
  code: ErrorCode;
  status: number;
  message: string;
  details?: ApiErrorBody['details'];
  logContext?: Record<string, unknown>;
  /** 5xx é incidente: vai para o log com stack. 4xx é comportamento esperado do cliente. */
  unexpected: boolean;
}

/**
 * Handler global de erros (E1-06 / doc 09 §1).
 *
 * Contrato: TODA resposta de erro da API tem exatamente `{code, message, correlationId, timestamp}`
 * (+ `details` em validação). Stack trace e contexto interno existem só no log estruturado —
 * o cliente recebe o correlationId para citar no suporte (doc 21).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { correlationId?: string }>();
    const response = ctx.getResponse<Response>();

    const normalized = this.normalize(exception);
    const correlationId =
      getCorrelationId() ??
      request?.correlationId ??
      sanitizeCorrelationId(request?.headers?.[CORRELATION_ID_HEADER]);

    const body: ApiErrorBody = {
      code: normalized.code,
      message: normalized.message,
      correlationId,
      timestamp: new Date().toISOString(),
      ...(normalized.details ? { details: normalized.details } : {}),
    };

    const logPayload = {
      event: 'request_error',
      code: normalized.code,
      status: normalized.status,
      method: request?.method,
      path: request?.route?.path ?? request?.path,
      correlation_id: correlationId,
      ...(normalized.logContext ? { context: redactObject(normalized.logContext) } : {}),
    };

    if (normalized.unexpected) {
      // Único lugar onde a stack aparece — e apenas no log (doc 09 §1).
      this.logger.error({ ...logPayload, err: exception }, 'unhandled_exception');
    } else {
      this.logger.warn(logPayload, 'handled_exception');
    }

    if (response.headersSent) return;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    response.status(normalized.status).json(body);
  }

  private normalize(exception: unknown): Normalized {
    if (exception instanceof AppException) {
      return {
        code: exception.code,
        status: exception.getStatus(),
        message: exception.message,
        details: exception.details,
        logContext: exception.logContext,
        unexpected: exception.getStatus() >= 500,
      };
    }

    if (exception instanceof ZodError) {
      return {
        code: 'VALIDATION_ERROR',
        status: ERROR_HTTP_STATUS.VALIDATION_ERROR,
        message: SAFE_MESSAGES.VALIDATION_ERROR,
        // Só caminho e regra: o valor rejeitado pode conter segredo ou PII.
        details: exception.issues.map((issue) => ({
          path: issue.path.join('.') || '(raiz)',
          rule: issue.code,
        })),
        unexpected: false,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const codeFromPayload =
        typeof payload === 'object' &&
        payload !== null &&
        isErrorCode((payload as { code?: unknown }).code)
          ? (payload as { code: ErrorCode }).code
          : undefined;
      const code =
        codeFromPayload ??
        HTTP_STATUS_TO_CODE[status] ??
        (status >= 500 ? 'INTERNAL' : 'VALIDATION_ERROR');
      return {
        code,
        status,
        // Mensagens de exceções nativas podem carregar detalhe interno: usamos a segura.
        message: SAFE_MESSAGES[code],
        unexpected: status >= 500,
      };
    }

    return {
      code: 'INTERNAL',
      status: ERROR_HTTP_STATUS.INTERNAL,
      message: SAFE_MESSAGES.INTERNAL,
      unexpected: true,
    };
  }
}
