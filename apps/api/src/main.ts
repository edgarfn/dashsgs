import { API_PREFIX } from '@dashsgs/shared';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { correlationMiddleware } from './common/correlation/correlation.middleware';
import { AppConfigService } from './config';

/** Corpo máximo aceito pela API interna: ela recebe filtros, não arquivos (doc 09 §1). */
const BODY_LIMIT = '256kb';

async function bootstrap(): Promise<void> {
  // bufferLogs: nada é impresso antes do logger estruturado existir — inclusive erros de boot.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  const config = app.get(AppConfigService);
  const logger = app.get(Logger);
  app.useLogger(logger);

  // 1) Correlação primeiro: todo log, métrica e erro deste request já nascem correlacionados.
  app.use(correlationMiddleware);

  // 2) Corpo com limite explícito (defesa contra consumo desenfreado — API4).
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT }));

  // 2.1) Cookies: a sessão vive num cookie opaco HttpOnly (ADR-004); o guard precisa dele parseado.
  app.use(cookieParser());

  // 3) Cabeçalhos de segurança (doc 09 §1). A CSP do app é responsabilidade do front/Caddy;
  //    aqui a API só devolve JSON, então a política restritiva padrão basta.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // CSP já diz frame-ancestors 'none'; o X-Frame-Options acompanha para navegador antigo.
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: config.isProduction ? { maxAge: 63_072_000, includeSubDomains: true } : false,
    }),
  );

  // 4) Atrás do Caddy: confiar apenas no primeiro proxy para IP real (rate limit e auditoria).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // 5) CORS restrito ao domínio do front, com credenciais (cookie de sessão — doc 09 §1).
  app.enableCors({
    origin: [config.appUrl],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Correlation-Id', 'X-Debug-Trace'],
    exposedHeaders: ['X-Correlation-Id'],
    maxAge: 600,
  });

  // 6) Prefixo único da API interna; health e métricas vivem fora dele (doc 18 §3).
  app.setGlobalPrefix(API_PREFIX, { exclude: ['healthz', 'readyz', 'metrics'] });

  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');

  logger.log({ event: 'api_started', config: config.safeSnapshot() }, 'api_started');
}

process.on('unhandledRejection', (reason) => {
  // Sem logger disponível com certeza neste ponto: escreve cru e deixa o supervisor reiniciar.
  process.stderr.write(`unhandledRejection: ${String(reason)}\n`);
  process.exitCode = 1;
});

void bootstrap();
