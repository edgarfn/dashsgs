import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ENV } from '../../config';
import { Inject } from '@nestjs/common';
import { type Env } from '../../config/env.schema';

/**
 * Cifra de envelope AES-256-GCM (doc 09 §2 "Gestão de segredos").
 *
 * Usada hoje pelo segredo TOTP e, na Fase 5, pela senha do ERP de cada tenant. A chave mestra
 * vive no ambiente (SOPS/KMS), nunca no banco; cada texto cifrado carrega a VERSÃO da chave que o
 * produziu, para que a rotação possa reescrever os registros aos poucos, sem downtime.
 *
 * Formato do blob: [versão:1][iv:12][tag:16][ciphertext:n]
 */
const VERSION_BYTES = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = VERSION_BYTES + IV_BYTES + TAG_BYTES;

export interface SealedSecret {
  ciphertext: Buffer;
  keyVersion: number;
}

@Injectable()
export class EnvelopeCryptoService {
  private readonly keys: Map<number, Buffer>;
  private readonly currentVersion: number;

  constructor(@Inject(ENV) env: Env) {
    this.currentVersion = env.MASTER_KEY_VERSION;
    this.keys = new Map([[env.MASTER_KEY_VERSION, Buffer.from(env.MASTER_KEY_CURRENT, 'base64')]]);
    if (env.MASTER_KEY_PREVIOUS) {
      // Durante a rotação, a chave anterior continua abrindo o que ainda não foi reescrito.
      this.keys.set(env.MASTER_KEY_VERSION - 1, Buffer.from(env.MASTER_KEY_PREVIOUS, 'base64'));
    }
  }

  /** Cifra com a chave corrente. O segredo em claro nunca deve ser persistido nem logado. */
  seal(plaintext: string): SealedSecret {
    const key = this.keyFor(this.currentVersion);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: Buffer.concat([Buffer.from([this.currentVersion & 0xff]), iv, tag, encrypted]),
      keyVersion: this.currentVersion,
    };
  }

  /**
   * Decifra. A tag GCM autentica o conteúdo: adulteração no banco vira exceção, não dado corrompido
   * passando por válido.
   */
  open(sealed: Buffer): string {
    if (sealed.length <= HEADER_BYTES) {
      throw new Error('blob cifrado malformado');
    }
    const version = sealed.readUInt8(0);
    const iv = sealed.subarray(VERSION_BYTES, VERSION_BYTES + IV_BYTES);
    const tag = sealed.subarray(VERSION_BYTES + IV_BYTES, HEADER_BYTES);
    const encrypted = sealed.subarray(HEADER_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', this.keyFor(version), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  /** Um blob precisa ser reescrito quando foi cifrado com chave antiga (runbook 22 §5). */
  needsRewrap(sealed: Buffer): boolean {
    return sealed.length > 0 && sealed.readUInt8(0) !== this.currentVersion;
  }

  private keyFor(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(`chave mestra versão ${version} não está disponível neste processo`);
    }
    return key;
  }
}
