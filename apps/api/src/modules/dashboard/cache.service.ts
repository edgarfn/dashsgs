import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { tenantCacheKey } from '@dashsgs/shared';
import { RedisService } from '../../common/redis/redis.service';

/** TTLs do doc 14 §6. O dia corrente muda o tempo todo; o histórico, não. */
export const TTL = {
  /** KPIs do dia corrente. */
  hoje: 60,
  /** Consultas históricas (comparativos, dias fechados, estoque). */
  historico: 900,
} as const;

/** Espera máxima por um cálculo em andamento antes de fazer o próprio (stampede). */
const ESPERA_LOCK_MS = 1_500;

/**
 * Cache de leitura do dashboard (doc 14 §6).
 *
 * Duas garantias, e elas explicam o código:
 *
 * 1. **Toda chave nasce prefixada pelo tenant** (`tenantCacheKey`), incluindo o recorte de
 *    filiais na assinatura. Dois usuários da mesma rede com `filiais_allowed` diferentes nunca
 *    compartilham a mesma entrada — seria vazamento por cache, o mais silencioso de todos.
 * 2. **Um cálculo por vez** para a mesma chave. Sem isso, o primeiro acesso da manhã (quando o
 *    cache expira e a rede inteira abre o painel) dispararia a mesma consulta pesada dezenas de
 *    vezes contra o banco.
 */
@Injectable()
export class DashboardCache {
  constructor(private readonly redis: RedisService) {}

  async lembrar<T>(
    tenantId: string,
    escopo: string,
    assinatura: Record<string, unknown>,
    ttlSegundos: number,
    calcular: () => Promise<T>,
  ): Promise<T> {
    const chave = this.chave(escopo, assinatura);

    const cacheado = await this.ler<T>(tenantId, chave);
    if (cacheado !== null) return cacheado;

    const lock = tenantCacheKey(tenantId, 'q', 'lock', chave);
    const adquiriu = await this.redis.client.set(lock, '1', 'EX', 30, 'NX');

    if (!adquiriu) {
      const esperado = await this.esperar<T>(tenantId, chave);
      if (esperado !== null) return esperado;
    }

    try {
      const valor = await calcular();
      // Nunca cacheamos erro (doc 14 §6): só o caminho feliz chega aqui.
      await this.redis.setTenantJson(tenantId, ['q', chave], valor, ttlSegundos);
      return valor;
    } finally {
      if (adquiriu) await this.redis.client.del(lock);
    }
  }

  /** Assinatura estável da consulta: mesma pergunta, mesma chave, independente da ordem. */
  private chave(escopo: string, assinatura: Record<string, unknown>): string {
    const normalizada = Object.keys(assinatura)
      .sort()
      .map((campo) => `${campo}=${JSON.stringify(assinatura[campo] ?? null)}`)
      .join('&');

    return `${escopo}:${createHash('sha256').update(normalizada).digest('hex').slice(0, 16)}`;
  }

  private async ler<T>(tenantId: string, chave: string): Promise<T | null> {
    try {
      return await this.redis.getTenantJson<T>(tenantId, 'q', chave);
    } catch {
      // Redis fora do ar não pode derrubar o dashboard: seguimos direto para o banco.
      return null;
    }
  }

  private async esperar<T>(tenantId: string, chave: string): Promise<T | null> {
    const limite = Date.now() + ESPERA_LOCK_MS;

    while (Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const valor = await this.ler<T>(tenantId, chave);
      if (valor !== null) return valor;
    }

    // Quem segurava o lock não terminou a tempo: melhor calcular de novo que devolver erro.
    return null;
  }
}
