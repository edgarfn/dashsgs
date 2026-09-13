import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { tenantLockKey } from '@dashsgs/shared';
import { PinoLogger } from 'nestjs-pino';
import { RedisService } from '../../common/redis/redis.service';

/**
 * Lock distribuído por (tenant, domínio) — doc 14 §5.
 *
 * Existe para uma coisa só: **nunca duas execuções simultâneas do mesmo escopo**. Sem isso, dois
 * workers baixando o mesmo dia da mesma filial disputariam o delete+insert da consolidação e um
 * deles apagaria o que o outro acabou de gravar.
 *
 * O valor guardado é um token aleatório: só solta o lock quem o adquiriu — um worker lento que
 * volta a si depois do TTL não pode liberar o lock de quem entrou depois dele.
 */
@Injectable()
export class SyncLockService {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SyncLockService.name);
  }

  /**
   * Executa `fn` sob lock. Se outro worker já estiver no mesmo escopo, devolve `null` — o job
   * termina como `skipped`, sem erro: a próxima cadência pega o que ficou.
   */
  async comLock<T>(
    tenantId: string,
    escopo: string,
    ttlSegundos: number,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    const chave = tenantLockKey(tenantId, 'sync', escopo);
    const token = randomUUID();

    const adquiriu = await this.redis.client.set(chave, token, 'EX', ttlSegundos, 'NX');
    if (!adquiriu) {
      this.logger.debug({ event: 'sync_lock_ocupado', tenant_id: tenantId, escopo }, 'sync_lock');
      return null;
    }

    // Renovação periódica: jobs longos (backfill de uma fatia) não podem perder o lock no meio.
    const renovacao = setInterval(
      () => {
        void this.renovar(chave, token, ttlSegundos);
      },
      Math.max(1_000, (ttlSegundos * 1_000) / 3),
    );
    renovacao.unref?.();

    try {
      return await fn();
    } finally {
      clearInterval(renovacao);
      await this.liberar(chave, token);
    }
  }

  /** Libera só se o token ainda for o nosso (compare-and-delete atômico via Lua). */
  private async liberar(chave: string, token: string): Promise<void> {
    const script = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      end
      return 0`;
    await this.redis.client.eval(script, 1, chave, token);
  }

  private async renovar(chave: string, token: string, ttlSegundos: number): Promise<void> {
    const script = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('expire', KEYS[1], ARGV[2])
      end
      return 0`;
    try {
      await this.redis.client.eval(script, 1, chave, token, String(ttlSegundos));
    } catch {
      // Renovação é melhor-esforço: falhar aqui não justifica abortar o job em andamento.
    }
  }
}
