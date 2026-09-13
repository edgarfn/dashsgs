import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { RedisService } from '../../../common/redis/redis.service';
import { SgError } from '../sg-errors';

/**
 * Disjuntor por tenant (doc 12 §3): 5 falhas em 60 s abrem o circuito por 120 s; depois disso,
 * uma única sonda decide se fecha de novo.
 *
 * Por que por tenant e não global: o ERP que caiu é o de UM cliente. Bloquear as chamadas dos
 * outros por causa dele seria transformar um incidente local em incidente da plataforma.
 *
 * O estado mora no Redis porque API e workers são processos diferentes — um disjuntor que só
 * existe na memória de um deles não protege o ERP do cliente.
 */
export type EstadoCircuito = 'fechado' | 'meio-aberto' | 'aberto';

const LIMITE_FALHAS = 5;
const JANELA_FALHAS_S = 60;
const TEMPO_ABERTO_S = 120;
const TTL_SONDA_S = 15;

@Injectable()
export class SgCircuitBreaker {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SgCircuitBreaker.name);
  }

  /**
   * Autoriza (ou não) uma chamada. Circuito aberto falha **rápido**: não adianta enfileirar
   * requisições para um ERP que acabou de recusar cinco seguidas.
   */
  async guard(tenantId: string, endpoint: string): Promise<EstadoCircuito> {
    const aberto = await this.redis.client.get(this.chaveAberto(tenantId));
    if (!aberto) return 'fechado';

    // Aberto: só uma sonda passa por vez (meio-aberto), e só depois do tempo de descanso.
    const restante = await this.redis.client.ttl(this.chaveAberto(tenantId));
    if (restante > 0) {
      throw new SgError('inalcancavel', {
        endpoint,
        mensagemOrigem: `circuito aberto por mais ${restante}s`,
      });
    }

    const sonda = await this.redis.client.set(
      this.chaveSonda(tenantId),
      '1',
      'EX',
      TTL_SONDA_S,
      'NX',
    );
    if (!sonda) {
      throw new SgError('inalcancavel', { endpoint, mensagemOrigem: 'sonda em andamento' });
    }

    return 'meio-aberto';
  }

  async onSuccess(tenantId: string): Promise<void> {
    await this.redis.client.del(
      this.chaveFalhas(tenantId),
      this.chaveAberto(tenantId),
      this.chaveSonda(tenantId),
    );
  }

  /** Registra a falha e abre o circuito quando o limite estoura (ou quando a sonda falhou). */
  async onFailure(tenantId: string, estado: EstadoCircuito): Promise<EstadoCircuito> {
    if (estado === 'meio-aberto') {
      await this.abrir(tenantId, 'sonda falhou');
      return 'aberto';
    }

    const falhas = await this.redis.client.incr(this.chaveFalhas(tenantId));
    if (falhas === 1) {
      await this.redis.client.expire(this.chaveFalhas(tenantId), JANELA_FALHAS_S);
    }

    if (falhas >= LIMITE_FALHAS) {
      await this.abrir(tenantId, `${falhas} falhas em ${JANELA_FALHAS_S}s`);
      return 'aberto';
    }

    return 'fechado';
  }

  /** 0 fechado · 1 meio-aberto · 2 aberto — formato da métrica `sg_circuit_state` (doc 18 §2). */
  async estado(tenantId: string): Promise<EstadoCircuito> {
    const [aberto, sonda] = await this.redis.client.mget(
      this.chaveAberto(tenantId),
      this.chaveSonda(tenantId),
    );
    if (!aberto) return 'fechado';
    return sonda ? 'meio-aberto' : 'aberto';
  }

  private async abrir(tenantId: string, motivo: string): Promise<void> {
    await this.redis.client.set(this.chaveAberto(tenantId), motivo, 'EX', TEMPO_ABERTO_S);
    await this.redis.client.del(this.chaveSonda(tenantId));
    this.logger.warn(
      { event: 'sg_circuit_open', tenant_id: tenantId, motivo, segundos: TEMPO_ABERTO_S },
      'sg_circuit_open',
    );
  }

  private chaveFalhas = (tenantId: string) => `sg:cb:falhas:${tenantId}`;
  private chaveAberto = (tenantId: string) => `sg:cb:aberto:${tenantId}`;
  private chaveSonda = (tenantId: string) => `sg:cb:sonda:${tenantId}`;
}
