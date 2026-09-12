import { HashingService, normalizeRecoveryCode } from '../../src/common/crypto/hashing.service';
import { type Env } from '../../src/config/env.schema';

const service = new HashingService({ PII_PEPPER: 'pepper-de-teste-32-bytes-ok' } as Env);
const outroPepper = new HashingService({ PII_PEPPER: 'outro-pepper-completamente' } as Env);

describe('HashingService', () => {
  describe('senha (Argon2id)', () => {
    // Argon2id com os parâmetros do doc 06 é lento de propósito.
    jest.setTimeout(30_000);

    it('verifica a senha correta e recusa a errada', async () => {
      const hash = await service.hashPassword('Cavalo-Bateria-Grampo-Correto');

      expect(hash).toMatch(/^\$argon2id\$/);
      expect(hash).not.toContain('Cavalo');
      await expect(service.verifyPassword(hash, 'Cavalo-Bateria-Grampo-Correto')).resolves.toBe(
        true,
      );
      await expect(service.verifyPassword(hash, 'Cavalo-Bateria-Grampo-Correta')).resolves.toBe(
        false,
      );
    });

    it('usa sal próprio: a mesma senha gera hashes diferentes', async () => {
      const [primeiro, segundo] = await Promise.all([
        service.hashPassword('mesma-senha-longa-aqui'),
        service.hashPassword('mesma-senha-longa-aqui'),
      ]);
      expect(primeiro).not.toBe(segundo);
    });

    it('trata hash ausente ou corrompido como senha inválida, sem explodir', async () => {
      await expect(service.verifyPassword(null, 'qualquer')).resolves.toBe(false);
      await expect(service.verifyPassword(undefined, 'qualquer')).resolves.toBe(false);
      await expect(service.verifyPassword('lixo-que-nao-e-hash', 'qualquer')).resolves.toBe(false);
    });
  });

  describe('tokens', () => {
    it('gera tokens de 256 bits, únicos e seguros para URL', () => {
      const tokens = new Set(Array.from({ length: 100 }, () => service.generateToken()));
      expect(tokens.size).toBe(100);
      for (const token of tokens) {
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      }
    });

    it('hash de token é determinístico (é assim que a sessão é encontrada)', () => {
      const token = service.generateToken();
      expect(service.hashToken(token)).toBe(service.hashToken(token));
      expect(service.hashToken(token)).toHaveLength(64);
      expect(service.hashToken(token)).not.toBe(service.hashToken(service.generateToken()));
    });
  });

  describe('códigos de recuperação', () => {
    it('normaliza caixa e separadores', () => {
      expect(normalizeRecoveryCode('AB2C-D3EF')).toBe('ab2cd3ef');
      expect(normalizeRecoveryCode('ab2c d3ef')).toBe('ab2cd3ef');
      expect(normalizeRecoveryCode('ab2cd3ef')).toBe('ab2cd3ef');
    });

    it('aceita o código digitado em qualquer formato', () => {
      const esperado = service.hashRecoveryCode('ab2c-d3ef');
      expect(service.hashRecoveryCode('AB2C-D3EF')).toBe(esperado);
      expect(service.hashRecoveryCode('ab2cd3ef')).toBe(esperado);
    });

    it('o pepper separa instalações: o mesmo código gera hashes diferentes', () => {
      expect(service.hashRecoveryCode('ab2c-d3ef')).not.toBe(
        outroPepper.hashRecoveryCode('ab2c-d3ef'),
      );
    });
  });

  describe('comparação em tempo constante', () => {
    it('compara corretamente', () => {
      expect(service.safeEquals('abc', 'abc')).toBe(true);
      expect(service.safeEquals('abc', 'abd')).toBe(false);
      expect(service.safeEquals('abc', 'abcd')).toBe(false);
      expect(service.safeEquals('', '')).toBe(true);
    });
  });
});
