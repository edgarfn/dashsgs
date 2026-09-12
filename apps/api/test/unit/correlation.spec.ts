import type { NextFunction, Request, Response } from 'express';
import {
  getCorrelationId,
  runWithCorrelation,
  sanitizeCorrelationId,
  setCorrelationFields,
} from '../../src/common/correlation/correlation.context';
import { correlationMiddleware } from '../../src/common/correlation/correlation.middleware';

const makeReqRes = (incoming?: string) => {
  const headers: Record<string, string> = {};
  if (incoming !== undefined) headers['x-correlation-id'] = incoming;
  const res = {
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  return { req: { headers } as unknown as Request, res: res as unknown as Response, res_: res };
};

describe('contexto de correlação', () => {
  it('preserva um id de correlação inofensivo vindo da borda', () => {
    const id = 'abc123-XYZ_456789';
    expect(sanitizeCorrelationId(id)).toBe(id);
  });

  it('descarta id forjado ou com injeção de log e gera um novo', () => {
    for (const hostile of ['../etc', 'a b c', 'x'.repeat(200), 'linha1\nlinha2', 42, undefined]) {
      const sanitized = sanitizeCorrelationId(hostile);
      expect(sanitized).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('propaga o id no contexto assíncrono e no header de resposta', async () => {
    const { req, res, res_ } = makeReqRes('req-da-borda-123');
    const seen: Array<string | undefined> = [];

    const next: NextFunction = () => {
      seen.push(getCorrelationId());
    };
    correlationMiddleware(req, res, next);

    expect(seen).toEqual(['req-da-borda-123']);
    expect(res_.headers['x-correlation-id']).toBe('req-da-borda-123');
  });

  it('sobrevive a fronteiras assíncronas dentro do mesmo request', async () => {
    await runWithCorrelation({ correlationId: 'fixo-12345678' }, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      expect(getCorrelationId()).toBe('fixo-12345678');
    });
    expect(getCorrelationId()).toBeUndefined();
  });

  it('permite enriquecer tenant/usuário sem trocar a correlação', () => {
    runWithCorrelation({ correlationId: 'fixo-12345678' }, () => {
      setCorrelationFields({ tenantId: 'tenant-a', userId: 'user-1' });
      expect(getCorrelationId()).toBe('fixo-12345678');
    });
  });
});
