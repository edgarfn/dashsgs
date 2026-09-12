import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { tenantCacheKey } from '@dashsgs/shared';
import Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../config';

/**
 * Redis: cache, locks e (a partir da Fase 6) filas BullMQ.
 *
 * Regra de isolamento (doc 08 §4): nenhuma chave de dados de tenant é escrita sem o prefixo
 * `t:<tenant_id>:`. Os helpers abaixo são o único caminho sancionado — o lint e os testes de
 * isolamento cobram isso.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;
  private connected = false;

  constructor(
    config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RedisService.name);
    this.client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      connectTimeout: 5_000,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    });
    this.client.on('ready', () => {
      this.connected = true;
      this.logger.info({ event: 'redis_ready' }, 'redis_ready');
    });
    this.client.on('error', (error: Error) => {
      this.connected = false;
      // Sem payload: a mensagem do driver pode conter a URL com credencial.
      this.logger.warn({ event: 'redis_error', name: error.name }, 'redis_error');
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch {
      // Boot não falha por Redis fora do ar: o /readyz reporta "down" e o balanceador
      // simplesmente não manda tráfego (doc 18 §3). Falhar aqui atrasaria o rollback.
      this.logger.error({ event: 'redis_connect_failed' }, 'redis_connect_failed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async ping(): Promise<void> {
    const reply = await this.client.ping();
    if (reply !== 'PONG') throw new Error('resposta inesperada do Redis');
  }

  /** Leitura de cache de tenant — chave sempre prefixada (doc 08 §4). */
  async getTenantJson<T>(tenantId: string, ...parts: Array<string | number>): Promise<T | null> {
    const raw = await this.client.get(tenantCacheKey(tenantId, ...parts));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  /** Escrita de cache de tenant com TTL obrigatório (nada imortal no cache). */
  async setTenantJson(
    tenantId: string,
    parts: Array<string | number>,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    if (ttlSeconds <= 0) throw new Error('TTL obrigatório no cache de tenant');
    await this.client.set(
      tenantCacheKey(tenantId, ...parts),
      JSON.stringify(value),
      'EX',
      ttlSeconds,
    );
  }

  /** Remove todo o cache de um tenant (offboarding/resync — doc 08 §5). */
  async purgeTenant(tenantId: string): Promise<number> {
    const pattern = tenantCacheKey(tenantId, '*');
    let removed = 0;
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) removed += await this.client.del(...keys);
    } while (cursor !== '0');
    return removed;
  }
}
