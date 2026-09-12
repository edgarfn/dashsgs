import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { ENV } from '../../config';
import { type Env } from '../../config/env.schema';

/**
 * Parâmetros Argon2id do doc 06 §Senhas: 64 MiB, 3 iterações, paralelismo 4.
 * (recalibrar por benchmark — a regra é manter o custo perceptível para o atacante e
 * imperceptível para quem faz login)
 */
export const ARGON2_OPTIONS = {
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * Hashes do domínio de identidade.
 *
 * Três materiais distintos, com tratamentos distintos de propósito:
 *  - **senha**: baixa entropia → Argon2id (lento, com sal próprio);
 *  - **token** (sessão, reset, convite): 256 bits aleatórios → SHA-256 simples é suficiente e
 *    precisa ser rápido, porque acontece a cada requisição;
 *  - **código de recuperação**: alta entropia → SHA-256 com pepper fora do banco.
 */
@Injectable()
export class HashingService {
  private readonly pepper: string;

  constructor(@Inject(ENV) env: Env) {
    this.pepper = env.PII_PEPPER;
  }

  async hashPassword(password: string): Promise<string> {
    return argon2Hash(password, ARGON2_OPTIONS);
  }

  /**
   * Verifica a senha. Retorna false em qualquer erro de formato — um hash corrompido no banco
   * não pode virar exceção 500 numa tela de login (e muito menos autenticar alguém).
   */
  async verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
    if (!hash) return false;
    try {
      return await argon2Verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Token opaco de 256 bits (sessão, reset, convite). */
  generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** Hash de token para armazenamento e lookup — determinístico, sem sal. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Hash de código de recuperação: pepper garante que o dump do banco não basta. */
  hashRecoveryCode(code: string): string {
    return createHmac('sha256', this.pepper).update(normalizeRecoveryCode(code)).digest('hex');
  }

  /** Comparação em tempo constante para segredos de mesmo comprimento. */
  safeEquals(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    if (bufferA.length !== bufferB.length) return false;
    return timingSafeEqual(bufferA, bufferB);
  }
}

/** Códigos são exibidos como `abcd-efgh`; aceitamos qualquer caixa e sem o hífen. */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}
