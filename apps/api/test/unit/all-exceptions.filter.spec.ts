import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { z } from 'zod';
import { AllExceptionsFilter } from '../../src/common/errors/all-exceptions.filter';
import { AppException } from '../../src/common/errors/app.exception';
import { runWithCorrelation } from '../../src/common/correlation/correlation.context';

interface CapturedResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function makeHost(): { host: ArgumentsHost; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: 0, body: {}, headers: {} };
  const response = {
    headersSent: false,
    setHeader: (name: string, value: string) => {
      captured.headers[name] = value;
    },
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      return this;
    },
  };
  const request = { method: 'GET', path: '/api/v1/kpi/overview', headers: {} };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

const logger = {
  setContext: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

const filter = new AllExceptionsFilter(logger as never);
const CORRELATION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const handle = (exception: unknown): CapturedResponse => {
  const { host, captured } = makeHost();
  runWithCorrelation({ correlationId: CORRELATION }, () => filter.catch(exception, host));
  return captured;
};

beforeEach(() => jest.clearAllMocks());

/** E1-06: corpo `{code,message,correlationId,timestamp}` em TODA resposta de erro. */
describe('AllExceptionsFilter', () => {
  it('responde o contrato padronizado para AppException', () => {
    const captured = handle(AppException.notFound({ tenantId: 'x' }));

    expect(captured.status).toBe(404);
    expect(Object.keys(captured.body).sort()).toEqual([
      'code',
      'correlationId',
      'message',
      'timestamp',
    ]);
    expect(captured.body.code).toBe('NOT_FOUND');
    expect(captured.body.correlationId).toBe(CORRELATION);
    expect(String(captured.body.timestamp)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(captured.headers['x-correlation-id']).toBe(CORRELATION);
  });

  it('traduz erro de validação zod em details sem o valor recusado', () => {
    const schema = z.object({ senha: z.string().min(8), page: z.number() });
    let thrown: unknown;
    try {
      schema.parse({ senha: '123', page: 'muitas' });
    } catch (error) {
      thrown = error;
    }

    const captured = handle(thrown);
    expect(captured.status).toBe(422);
    expect(captured.body.code).toBe('VALIDATION_ERROR');
    expect(captured.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'senha' })]),
    );
    // O valor enviado (que pode ser uma senha real) nunca ecoa na resposta.
    expect(JSON.stringify(captured.body)).not.toContain('123');
  });

  it('mapeia exceções nativas do Nest para o catálogo interno', () => {
    const captured = handle(new ForbiddenException('detalhe interno com nome de tabela'));
    expect(captured.status).toBe(403);
    expect(captured.body.code).toBe('FORBIDDEN');
    expect(captured.body.message).not.toContain('tabela');
  });

  it('não vaza stack nem mensagem de erro inesperado (doc 17 §2)', () => {
    const captured = handle(new Error('conexao recusada em 10.0.0.5:5432 usuario app_rw'));

    expect(captured.status).toBe(500);
    expect(captured.body.code).toBe('INTERNAL');
    const serialized = JSON.stringify(captured.body);
    expect(serialized).not.toContain('10.0.0.5');
    expect(serialized).not.toContain('app_rw');
    expect(serialized).not.toContain('stack');
    // O incidente vai inteiro para o log estruturado, com correlação.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('trata 4xx como evento esperado (warn) e 5xx como incidente (error)', () => {
    handle(new HttpException('x', HttpStatus.CONFLICT));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('gera correlação mesmo sem contexto assíncrono ativo', () => {
    const { host, captured } = makeHost();
    filter.catch(AppException.forbidden(), host);
    expect(String(captured.body.correlationId)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
