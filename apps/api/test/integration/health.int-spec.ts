import { API_PREFIX } from '@dashsgs/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { correlationMiddleware } from '../../src/common/correlation/correlation.middleware';

/**
 * Teste de integração do esqueleto (E1-01/E1-03/E1-06): exige Postgres e Redis reais —
 * o compose de dev ou os services do CI. É o gate que prova que `/readyz` diz a verdade.
 */
describe('esqueleto da API (integração)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.use(correlationMiddleware);
    app.setGlobalPrefix(API_PREFIX, { exclude: ['healthz', 'readyz', 'metrics'] });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /healthz responde vivo sem tocar em dependência', async () => {
    const response = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(response.body).toMatchObject({ state: 'ok' });
    expect(response.body.version).toBeDefined();
  });

  it('GET /readyz confirma Postgres, Redis e migrações aplicadas', async () => {
    const response = await request(app.getHttpServer()).get('/readyz');

    // Asserção sobre os checks primeiro: se algo estiver fora, a mensagem diz o quê.
    const byName = Object.fromEntries(
      (response.body.checks as Array<{ name: string; state: string; detail?: string }>).map(
        (check) => [check.name, check.detail ? `${check.state} (${check.detail})` : check.state],
      ),
    );
    expect(byName.postgres).toBe('ok');
    expect(byName.redis).toBe('ok');
    // O número de migrações cresce a cada fase; o que importa é estarem todas aplicadas.
    expect(byName.migrations).toMatch(/^ok \(\d+ aplicada\(s\)\)$/);
    expect(response.body.state).toBe('ok');
    expect(response.status).toBe(200);
  });

  it('GET /metrics expõe as séries do doc 18 §2', async () => {
    const response = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(response.text).toContain('http_requests_total');
    expect(response.text).toContain('dashsgs_process_cpu_user_seconds_total');
  });

  /**
   * As regras do Prometheus e os cinco painéis (docker/observability/) casam por NOME. O gate
   * `pnpm obs:check` confere isso contra o fonte do registro; este teste confere contra a
   * saída de verdade — métrica registrada e nunca exportada daria no mesmo silêncio.
   */
  it('GET /metrics publica cada família que regra ou painel cita', async () => {
    const response = await request(app.getHttpServer()).get('/metrics').expect(200);
    const familias = [
      'http_request_duration_seconds',
      'http_errors_total',
      'sessions_active',
      'login_failures_total',
      'export_jobs_total',
      'sg_api_calls_total',
      'sg_api_duration_seconds',
      'sg_token_refresh_total',
      'sg_circuit_state',
      'sg_invalid_items_total',
      'sg_rate_limit_wait_seconds',
      'sync_runs_total',
      'sync_duration_seconds',
      'sync_lag_seconds',
      'sync_items_upserted_total',
      'queue_depth',
      'queue_dlq_depth',
      'job_retries_total',
      'alert_events_total',
      'alert_notifications_total',
      'alert_delivery_seconds',
      'retention_pending_rows',
      'retention_rows_purged_total',
      'retention_last_run_timestamp_seconds',
      'breakglass_grants_active',
      'breakglass_oldest_grant_seconds',
    ];

    // `# TYPE` e não o valor: contador com rótulo só ganha amostra depois do primeiro evento,
    // e o que precisa existir desde o boot é a DECLARAÇÃO — é o que o scrape enxerga.
    const ausentes = familias.filter((nome) => !response.text.includes(`# TYPE ${nome} `));
    expect(ausentes).toEqual([]);
  });

  it(`GET ${API_PREFIX}/meta devolve metadados da instalação`, async () => {
    const response = await request(app.getHttpServer()).get(`${API_PREFIX}/meta`).expect(200);
    expect(response.body).toMatchObject({ name: 'DashSGS', environment: 'test' });
  });

  it('rota inexistente devolve o erro padronizado com correlação', async () => {
    const response = await request(app.getHttpServer())
      .get(`${API_PREFIX}/rota-que-nao-existe`)
      .set('x-correlation-id', 'teste-integracao-01')
      .expect(404);

    expect(response.body).toMatchObject({
      code: 'NOT_FOUND',
      correlationId: 'teste-integracao-01',
    });
    expect(response.headers['x-correlation-id']).toBe('teste-integracao-01');
    expect(response.body.message).not.toContain('Cannot GET');
  });
});
