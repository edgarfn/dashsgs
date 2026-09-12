import { randomBytes } from 'node:crypto';
import { type TotpSetupResponse } from '@dashsgs/shared';
import { Injectable } from '@nestjs/common';
import * as OTPAuth from 'otpauth';
import { toDataURL } from 'qrcode';
import { EnvelopeCryptoService, HashingService } from '../../../common/crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

/** Parâmetros RFC 6238 usados pelos apps autenticadores (Google Authenticator, Authy, 1Password). */
const TOTP_CONFIG = { algorithm: 'SHA1', digits: 6, period: 30 } as const;
/** Tolerância de ±1 passo (30 s) para relógio fora de sincronia. */
const TOTP_WINDOW = 1;
/** O segredo pendente vive só o tempo de a pessoa ler o QR e digitar o código. */
const SETUP_TTL_SECONDS = 900;
const RECOVERY_CODE_COUNT = 10;

@Injectable()
export class TotpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crypto: EnvelopeCryptoService,
    private readonly hashing: HashingService,
  ) {}

  /**
   * Inicia o cadastro: gera um segredo e o guarda **pendente** no Redis, cifrado e com TTL.
   * O segredo só migra para o banco quando a pessoa provar que o app está configurado — assim
   * um cadastro abandonado não deixa MFA meio-ligado na conta.
   */
  async startSetup(userId: string, email: string): Promise<TotpSetupResponse> {
    // 20 bytes = 160 bits, o tamanho recomendado pela RFC 4226 §4 para a chave HMAC-SHA1.
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = this.build(secret.base32, email);
    const uri = totp.toString();

    const sealed = this.crypto.seal(secret.base32);
    await this.redis.client.set(
      this.setupKey(userId),
      sealed.ciphertext.toString('base64'),
      'EX',
      SETUP_TTL_SECONDS,
    );

    return {
      secret: secret.base32,
      uri,
      qrCodeDataUrl: await toDataURL(uri, { margin: 1, width: 240, errorCorrectionLevel: 'M' }),
    };
  }

  /**
   * Conclui o cadastro. Devolve os códigos de recuperação em claro — é a única vez que eles
   * existem fora do hash, e a UI precisa deixar isso explícito.
   */
  async enable(userId: string, email: string, code: string): Promise<string[] | null> {
    const pending = await this.redis.client.get(this.setupKey(userId));
    if (!pending) return null;

    const secret = this.crypto.open(Buffer.from(pending, 'base64'));
    if (!this.validate(secret, email, code)) return null;

    const sealed = this.crypto.seal(secret);
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          totpSecretCiphertext: new Uint8Array(sealed.ciphertext),
          totpKeyVersion: sealed.keyVersion,
          totpEnabled: true,
        },
      }),
      this.prisma.totpRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.totpRecoveryCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: this.hashing.hashRecoveryCode(code) })),
      }),
    ]);

    await this.redis.client.del(this.setupKey(userId));
    return codes;
  }

  /** Verifica um código do app autenticador contra o segredo ativo da conta. */
  async verify(userId: string, email: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecretCiphertext: true, totpEnabled: true },
    });
    if (!user?.totpEnabled || !user.totpSecretCiphertext) return false;

    const secret = this.crypto.open(Buffer.from(user.totpSecretCiphertext));
    return this.validate(secret, email, code);
  }

  /**
   * Consome um código de recuperação (uso único). Feito em UPDATE condicional: duas tentativas
   * simultâneas com o mesmo código não passam as duas.
   */
  async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const codeHash = this.hashing.hashRecoveryCode(code);
    const result = await this.prisma.totpRecoveryCode.updateMany({
      where: { userId, codeHash, usedAt: null },
      data: { usedAt: new Date() },
    });
    return result.count === 1;
  }

  async countUnusedRecoveryCodes(userId: string): Promise<number> {
    return this.prisma.totpRecoveryCode.count({ where: { userId, usedAt: null } });
  }

  async disable(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { totpSecretCiphertext: null, totpKeyVersion: null, totpEnabled: false },
      }),
      this.prisma.totpRecoveryCode.deleteMany({ where: { userId } }),
    ]);
    await this.redis.client.del(this.setupKey(userId));
  }

  private build(secretBase32: string, email: string): OTPAuth.TOTP {
    return new OTPAuth.TOTP({
      issuer: 'DashSGS',
      label: email,
      algorithm: TOTP_CONFIG.algorithm,
      digits: TOTP_CONFIG.digits,
      period: TOTP_CONFIG.period,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
  }

  private validate(secretBase32: string, email: string, code: string): boolean {
    const delta = this.build(secretBase32, email).validate({
      token: code.trim(),
      window: TOTP_WINDOW,
    });
    return delta !== null;
  }

  private setupKey(userId: string): string {
    return `totp:setup:${userId}`;
  }
}

/** Sem i, l, o, 0 e 1: o código é ditado por telefone e anotado à mão. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Código no formato `ab2c-d3ef` (~39 bits).
 *
 * Amostragem por rejeição em vez de `byte % alfabeto`: o módulo favoreceria os primeiros
 * símbolos do alfabeto, e um código de recuperação é credencial — não pode ter viés.
 */
export function generateRecoveryCode(): string {
  const limite = 256 - (256 % RECOVERY_ALPHABET.length);
  const chars: string[] = [];

  while (chars.length < 8) {
    for (const byte of randomBytes(16)) {
      if (byte >= limite) continue;
      chars.push(RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length] as string);
      if (chars.length === 8) break;
    }
  }

  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}
