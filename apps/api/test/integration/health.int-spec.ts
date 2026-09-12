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
    expect(byName).toEqual({ postgres: 'ok', redis: 'ok', migrations: 'ok (1 aplicada(s))' });
    expect(response.body.state).toBe('ok');
    expect(response.status).toBe(200);
  });

  it('GET /metrics expõe as séries do doc 18 §2', async () => {
    const response = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(response.text).toContain('http_requests_total');
    expect(response.text).toContain('dashsgs_process_cpu_user_seconds_total');
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
