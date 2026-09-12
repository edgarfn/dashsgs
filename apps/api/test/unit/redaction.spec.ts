import {
  PINO_REDACT_PATHS,
  REDACTED,
  isSensitiveField,
  normalizeFieldName,
  redactObject,
} from '../../src/common/logging/redaction';

/**
 * Gate do doc 18 §1 e do doc 17 §2 ("Redaction: logs de teste não contêm senha/token").
 * Se alguém afrouxar a política, este teste cai antes do segredo vazar em produção.
 */
describe('redaction', () => {
  it('normaliza nomes com acento, caixa e separador', () => {
    expect(normalizeFieldName('Senha')).toBe('senha');
    expect(normalizeFieldName('CPF_CNPJ')).toBe('cpfcnpj');
    expect(normalizeFieldName('data-nascimento')).toBe('datanascimento');
    expect(normalizeFieldName('Endereço')).toBe('endereco');
  });

  it('reconhece os campos proibidos em log', () => {
    for (const field of ['password', 'senha', 'Authorization', 'token', 'cpf', 'email']) {
      expect(isSensitiveField(field)).toBe(true);
    }
    expect(isSensitiveField('filialId')).toBe(false);
    expect(isSensitiveField('valorTotal')).toBe(false);
  });

  it('mascara segredos e PII em profundidade, preservando o resto', () => {
    const payload = {
      usuario: 'operador',
      senha: 'p4ssw0rd-do-erp',
      conexao: {
        baseUrl: 'https://erp.cliente.com.br',
        Authorization: 'Bearer eyJhbGciOi...',
        credenciais: { token: 'abc123', cpf: '123.456.789-00' },
      },
      itens: [{ produto: 42, email: 'cliente@exemplo.com' }],
    };

    const result = redactObject(payload) as Record<string, unknown>;
    const serialized = JSON.stringify(result);

    expect(result.senha).toBe(REDACTED);
    expect(serialized).not.toContain('p4ssw0rd-do-erp');
    expect(serialized).not.toContain('eyJhbGciOi');
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('123.456.789-00');
    expect(serialized).not.toContain('cliente@exemplo.com');

    // O que não é sensível continua legível — log sem informação não serve para nada.
    expect(serialized).toContain('operador');
    expect(serialized).toContain('https://erp.cliente.com.br');
    expect(serialized).toContain('42');
  });

  it('corta ciclos e profundidade excessiva em vez de estourar o log', () => {
    const cyclic: Record<string, unknown> = { nome: 'x' };
    cyclic.self = cyclic;
    expect(JSON.stringify(redactObject(cyclic))).toContain('[CIRCULAR]');

    let deep: Record<string, unknown> = { fim: true };
    for (let i = 0; i < 12; i += 1) deep = { nivel: deep };
    expect(JSON.stringify(redactObject(deep))).toContain('[TRUNCATED]');
  });

  it('converte Error em objeto sem stack', () => {
    const result = redactObject({ err: new Error('boom') }) as { err: Record<string, unknown> };
    expect(result.err).toEqual({ name: 'Error', message: 'boom' });
    expect(result.err).not.toHaveProperty('stack');
  });

  it('entrega ao pino os caminhos de header sensíveis', () => {
    expect(PINO_REDACT_PATHS).toContain('req.headers.authorization');
    expect(PINO_REDACT_PATHS).toContain('req.headers.cookie');
    expect(PINO_REDACT_PATHS).toContain('res.headers["set-cookie"]');
    expect(PINO_REDACT_PATHS).toContain('*.senha');
  });
});
