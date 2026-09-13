import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { RedisService } from '../../../common/redis/redis.service';

export type PrioridadeChamada = 'tempo-real' | 'interativo' | 'backfill';

/** Quanto cada prioridade aceita esperar antes de desistir (doc 12 §3). */
const ESPERA_MAXIMA_MS: Record<PrioridadeChamada, number> = {
  'tempo-real': 5_000,
  interativo: 10_000,
  backfill: 60_000,
};

export interface ResultadoLimite {
  esperaMs: number;
  desistiu: boolean;
}

/**
 * Self-rate-limit por tenant (doc 12 §3 / doc 09 §3 API4).
 *
 * A API SG **não documenta limite** (doc 34 Q3) e roda no servidor da loja — o mesmo que atende
 * os caixas. O risco aqui não é sermos bloqueados: é derrubarmos o ERP do cliente no horário de
 * pico. Por isso o limite é nosso, por tenant, e conservador por padrão (4 req/s).
 *
 * Janela fixa de 1 segundo, e não token bucket: a operação é um `INCR` atômico, o efeito de borda
 * é de no máximo o dobro num intervalo de 1 s, e isso está bem dentro da margem de segurança —
 * enquanto um bucket distribuído exigiria script Lua e estado extra para o mesmo resultado prático.
 */
@Injectable()
export class SgRateLimiter {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SgRateLimiter.name);
  }

  /**
   * Espera até ter uma vaga no segundo corrente. Devolve quanto esperou (alimenta a métrica
   * `sg_rate_limit_wait_seconds`) e se desistiu por exceder o teto da prioridade.
   */
  async acquire(
    tenantId: string,
    maxRps: number,
    prioridade: PrioridadeChamada = 'interativo',
  ): Promise<ResultadoLimite> {
    const limite = Math.max(1, maxRps);
    const tetoEspera = ESPERA_MAXIMA_MS[prioridade];
    const inicio = Date.now();

    for (;;) {
      const agora = Date.now();
      const segundo = Math.floor(agora / 1000);
      const chave = `sg:rl:${tenantId}:${segundo}`;

      let usados: number;
      try {
        usados = await this.redis.client.incr(chave);
        if (usados === 1) await this.redis.client.expire(chave, 2);
      } catch {
        // Redis fora do ar não pode parar a sincronização; o limite volta a valer quando ele
        // voltar. O risco de curto prazo é menor que o de congelar os dados do cliente.
        return { esperaMs: Date.now() - inicio, desistiu: false };
      }

      if (usados <= limite) {
        return { esperaMs: Date.now() - inicio, desistiu: false };
      }

      if (Date.now() - inicio >= tetoEspera) {
        this.logger.warn(
          { event: 'sg_rate_limit_desistencia', tenant_id: tenantId, prioridade, maxRps: limite },
          'sg_rate_limit_desistencia',
        );
        return { esperaMs: Date.now() - inicio, desistiu: true };
      }

      // Dorme até o próximo segundo, com um sal aleatório para não sincronizar todos os workers
      // na mesma borda (efeito manada).
      const ateProximoSegundo = 1000 - (agora % 1000);
      await this.dormir(ateProximoSegundo + Math.floor(Math.random() * 50));
    }
  }

  private dormir(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
