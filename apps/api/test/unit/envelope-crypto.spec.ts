import { EnvelopeCryptoService } from '../../src/common/crypto/envelope-crypto.service';
import { type Env } from '../../src/config/env.schema';

const keyA = Buffer.alloc(32, 0xa1).toString('base64');
const keyB = Buffer.alloc(32, 0xb2).toString('base64');

const envWith = (overrides: Partial<Env>): Env =>
  ({
    MASTER_KEY_CURRENT: keyA,
    MASTER_KEY_VERSION: 1,
    ...overrides,
  }) as Env;

describe('EnvelopeCryptoService', () => {
  const crypto = new EnvelopeCryptoService(envWith({}));

  it('cifra e decifra preservando o conteúdo', () => {
    const segredo = 'senha-do-erp-do-tenant-42';
    const sealed = crypto.seal(segredo);

    expect(sealed.keyVersion).toBe(1);
    expect(sealed.ciphertext.toString('utf8')).not.toContain('senha');
    expect(crypto.open(sealed.ciphertext)).toBe(segredo);
  });

  it('gera IV novo a cada chamada (dois textos iguais não viram o mesmo blob)', () => {
    const primeiro = crypto.seal('mesmo-texto').ciphertext.toString('base64');
    const segundo = crypto.seal('mesmo-texto').ciphertext.toString('base64');
    expect(primeiro).not.toBe(segundo);
  });

  it('detecta adulteração do texto cifrado (tag GCM)', () => {
    const sealed = crypto.seal('conteudo-integro').ciphertext;
    const adulterado = Buffer.from(sealed);
    adulterado.writeUInt8(
      adulterado.readUInt8(adulterado.length - 1) ^ 0xff,
      adulterado.length - 1,
    );

    expect(() => crypto.open(adulterado)).toThrow();
  });

  it('recusa blob truncado', () => {
    expect(() => crypto.open(Buffer.alloc(8))).toThrow('malformado');
  });

  it('abre o que foi cifrado com a chave anterior durante a rotação', () => {
    const antigo = new EnvelopeCryptoService(
      envWith({ MASTER_KEY_CURRENT: keyA, MASTER_KEY_VERSION: 1 }),
    );
    const blob = antigo.seal('segredo-antigo').ciphertext;

    const rotacionado = new EnvelopeCryptoService(
      envWith({ MASTER_KEY_CURRENT: keyB, MASTER_KEY_VERSION: 2, MASTER_KEY_PREVIOUS: keyA }),
    );

    expect(rotacionado.open(blob)).toBe('segredo-antigo');
    expect(rotacionado.needsRewrap(blob)).toBe(true);
    expect(rotacionado.needsRewrap(rotacionado.seal('novo').ciphertext)).toBe(false);
  });

  it('falha claramente quando a chave que cifrou não está no processo', () => {
    const antigo = new EnvelopeCryptoService(
      envWith({ MASTER_KEY_CURRENT: keyA, MASTER_KEY_VERSION: 1 }),
    );
    const blob = antigo.seal('segredo-orfao').ciphertext;

    const semChaveAntiga = new EnvelopeCryptoService(
      envWith({ MASTER_KEY_CURRENT: keyB, MASTER_KEY_VERSION: 3 }),
    );

    expect(() => semChaveAntiga.open(blob)).toThrow('chave mestra versão 1');
  });
});
