import { computeEntryHash } from '../../src/common/audit/audit.service';

const entrada = (overrides: Record<string, unknown> = {}) => ({
  action: 'auth.login.succeeded',
  resourceType: 'session',
  resourceId: 'sessao-1',
  result: 'success',
  tenantId: 'tenant-a',
  userId: 'user-1',
  sessionId: 'sessao-1',
  ip: '10.0.0.1',
  userAgent: 'jest',
  changes: null,
  createdAt: '2026-09-12T12:00:00.000Z',
  ...overrides,
});

/**
 * Propriedades da cadeia (doc 05 §6): o hash tem de ser determinístico, sensível a qualquer
 * campo e dependente do elo anterior — é isso que torna a adulteração detectável.
 */
describe('cadeia de hash da auditoria', () => {
  it('é determinística para a mesma entrada e o mesmo elo anterior', () => {
    const prev = Buffer.alloc(32, 7);
    expect(computeEntryHash(prev, entrada())).toEqual(computeEntryHash(prev, entrada()));
  });

  it('muda quando qualquer campo muda', () => {
    const base = computeEntryHash(null, entrada());
    const variacoes = [
      { action: 'auth.login.failed' },
      { result: 'denied' },
      { userId: 'user-2' },
      { tenantId: 'tenant-b' },
      { ip: '10.0.0.2' },
      { createdAt: '2026-09-12T12:00:00.001Z' },
      { changes: { reason: 'senha_invalida' } },
    ];

    for (const variacao of variacoes) {
      expect(computeEntryHash(null, entrada(variacao))).not.toEqual(base);
    }
  });

  it('depende do elo anterior (mesma linha em posições diferentes tem hash diferente)', () => {
    const genesis = computeEntryHash(null, entrada());
    const encadeado = computeEntryHash(genesis, entrada());
    expect(encadeado).not.toEqual(genesis);
  });

  it('quebrar um elo invalida todos os seguintes', () => {
    const elo1 = computeEntryHash(null, entrada({ resourceId: 'a' }));
    const elo2 = computeEntryHash(elo1, entrada({ resourceId: 'b' }));
    const elo3 = computeEntryHash(elo2, entrada({ resourceId: 'c' }));

    // Alguém adultera a primeira linha; o hash recalculado não bate com o gravado.
    const elo1Adulterado = computeEntryHash(null, entrada({ resourceId: 'a-adulterado' }));
    expect(elo1Adulterado).not.toEqual(elo1);

    // E, como o elo 2 usava o hash antigo, a divergência se propaga até o fim da cadeia.
    const elo2Recalculado = computeEntryHash(elo1Adulterado, entrada({ resourceId: 'b' }));
    expect(elo2Recalculado).not.toEqual(elo2);
    expect(computeEntryHash(elo2Recalculado, entrada({ resourceId: 'c' }))).not.toEqual(elo3);
  });

  it('produz sha256 (32 bytes)', () => {
    expect(computeEntryHash(null, entrada())).toHaveLength(32);
  });
});
