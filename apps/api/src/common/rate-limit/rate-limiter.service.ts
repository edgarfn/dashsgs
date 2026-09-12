import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { RedisService } from '../redis/redis.service';

export interface RateLimitRule {
  /** Quantas tentativas são aceitas dentro da janela. */
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Limites do doc 09 §1 ("Backend") e do doc 06 §Fluxos. */
export const RATE_LIMITS = {
  /** Login por IP: 10/min. */
  loginByIp: { limit: 10, windowSeconds: 60 },
  /** Login por conta: 5/min — o lockout incremental no banco cuida da persistência. */
  loginByAccount: { limit: 5, windowSeconds: 60 },
  /** Verificação de TOTP: 5 tentativas a cada 5 min (doc 06 §MFA). */
  totpVerify: { limit: 5, windowSeconds: 300 },
  /** Pedido de recuperação de senha por IP. */
  passwordForgot: { limit: 5, windowSeconds: 900 },
  /** Aceite de convite por IP — evita varredura de tokens. */
  inviteLookup: { limit: 20, windowSeconds: 900 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Rate limiting por janela fixa no Redis (doc 09 §1).
 *
 * Janela fixa, e não deslizante, de propósito: é uma operação atômica (INCR + EXPIRE), custa uma
 * chave por sujeito e o efeito de borda — até 2× o limite na virada — é irrelevante para o que
 * estamos contendo (força bruta de credencial, não tráfego de API pago).
 *
 * Redis fora do ar: a requisição **passa** e o fato vira log de alerta. Bloquear login porque o
 * cache caiu seria negar serviço a todo mundo para conter um atacante hipotético — e o lockout
 * incremental em `app_users` continua de pé, no banco.
 */
@Injectable()
export class RateLimiterService {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RateLimiterService.name);
  }

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;
    try {
      const pipeline = this.redis.client.multi();
      pipeline.incr(redisKey);
      pipeline.ttl(redisKey);
      const replies = await pipeline.exec();

      const count = Number(replies?.[0]?.[1] ?? 0);
      let ttl = Number(replies?.[1]?.[1] ?? -1);

      if (ttl < 0) {
        await this.redis.client.expire(redisKey, rule.windowSeconds);
        ttl = rule.windowSeconds;
      }

      const allowed = count <= rule.limit;
      if (!allowed) {
        this.logger.warn(
          { event: 'rate_limit_exceeded', key, limit: rule.limit },
          'rate_limit_exceeded',
        );
      }

      return {
        allowed,
        remaining: Math.max(0, rule.limit - count),
        retryAfterSeconds: allowed ? 0 : ttl,
      };
    } catch (error) {
      this.logger.error(
        { event: 'rate_limit_unavailable', key, err: error },
        'rate_limit_unavailable',
      );
      return { allowed: true, remaining: rule.limit, retryAfterSeconds: 0 };
    }
  }

  /** Zera o contador — chamado após sucesso, para não punir quem acertou a senha. */
  async reset(key: string): Promise<void> {
    try {
      await this.redis.client.del(`rl:${key}`);
    } catch {
      // Contador que não zera apenas expira sozinho; não vale derrubar o login por isso.
    }
  }
}
