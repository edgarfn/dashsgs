import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { MetricsService } from './common/metrics/metrics.service';
import { AppConfigService } from './config';
import { WorkerModule } from './worker.module';

/**
 * Entrada do processo de worker (doc 04 §2 / doc 19 §2).
 *
 * Sem API: só o contexto da aplicação, as filas e um endpoint de métricas. Roda no mesmo
 * artefato da API — mesma imagem, mesmo código, outro comando — porque worker que compila de
 * outro lugar inevitavelmente diverge da API no pior momento.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });

  const logger = app.get(Logger);
  const config = app.get(AppConfigService);
  app.useLogger(logger);

  // O worker é onde a sincronização acontece — e, portanto, onde `sync_runs_total`,
  // `sync_duration_seconds` e companhia são medidos. Sem este servidor mínimo, esses números
  // existiriam na memória de um processo que ninguém consegue raspar (doc 18 §2).
  const metrics = app.get(MetricsService);
  const observabilidade = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (req.url === '/metrics' && config.metricsEnabled) {
      void metrics.scrape().then((corpo) => {
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(corpo);
      });
      return;
    }
    res.writeHead(404).end();
  });

  observabilidade.listen(config.sync.workerPort, '0.0.0.0');

  // Desligamento gracioso: o BullMQ espera o job corrente terminar antes de fechar (SyncWorker).
  app.enableShutdownHooks();
  process.on('SIGTERM', () => observabilidade.close());

  logger.log(
    { event: 'worker_started', porta: config.sync.workerPort, config: config.safeSnapshot() },
    'worker_started',
  );
}

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`unhandledRejection: ${String(reason)}\n`);
  process.exitCode = 1;
});

void bootstrap();
