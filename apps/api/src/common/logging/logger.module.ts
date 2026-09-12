import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppConfigService } from '../../config';
import { getCorrelationStore, sanitizeCorrelationId } from '../correlation/correlation.context';
import { PINO_REDACT_PATHS, REDACTED } from './redaction';

/** Rotas de infraestrutura não poluem o log de acesso (doc 18 §1 — ruído vira custo). */
const IGNORED_ROUTES = new Set(['/healthz', '/readyz', '/metrics', '/favicon.ico']);

/**
 * Logger estruturado JSON com os campos padrão do doc 18 §1:
 * `ts, level, msg, service, correlation_id, tenant_id?, user_id?, module, event`.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logLevel,
          // Em dev, saída legível; em qualquer outro ambiente, JSON puro para o coletor (Loki).
          transport: config.isDevelopment
            ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss.l' } }
            : undefined,
          base: { service: 'dashsgs-api' },
          timestamp: () => `,"ts":"${new Date().toISOString()}"`,
          messageKey: 'msg',
          redact: { paths: PINO_REDACT_PATHS, censor: REDACTED },
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const fromContext = getCorrelationStore()?.correlationId;
            const id = fromContext ?? sanitizeCorrelationId(req.headers['x-correlation-id']);
            res.setHeader('x-correlation-id', id);
            return id;
          },
          customProps: () => {
            const store = getCorrelationStore();
            return {
              correlation_id: store?.correlationId,
              tenant_id: store?.tenantId,
              user_id: store?.userId,
            };
          },
          autoLogging: {
            ignore: (req: IncomingMessage) =>
              IGNORED_ROUTES.has((req.url ?? '').split('?')[0] ?? ''),
          },
          // Serializers enxutos: nada de corpo, nada de headers além do essencial.
          serializers: {
            req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({
              id: req.id,
              method: req.method,
              url: (req.url ?? '').split('?')[0],
              ip: req.remoteAddress,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          customSuccessMessage: () => 'http_request',
          customErrorMessage: () => 'http_request_failed',
        },
      }),
    }),
  ],
})
export class LoggerModule {}
