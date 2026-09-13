import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { MetricsService } from '../../common/metrics/metrics.service';
import { RedisService } from '../../common/redis/redis.service';
import { SgHttpClient, type SgConnectionContext } from './http/sg-http.client';
import { SgError } from './sg-errors';
import { autorizacaoResponseSchema } from './types';

/** Caminho documentado da autorização (doc 02 §2); no SG Cloud ganha o prefixo `/public`. */
export const AUTH_PATH = '/integracao/sgsistemas/v1/autorizacao';
export const AUTH_PATH_CLOUD = '/public/integracao/sgsistemas/v1/autorizacao';

/**
 * O token vale 1 hora (doc 02 §2). Renovamos aos 50 minutos: os 10 minutos de folga cobrem
 * relógio fora de sincronia entre o nosso servidor e o da loja — e `expire_time` vem **sem
 * timezone**, então confiar nele ao pé da letra seria apostar (doc 02 §2 "Crítica").
 */
const TTL_CACHE_S = 50 * 60;
const TTL_LOCK_S = 20;

export interface TokenSg {
  token: string;
  /** Claim `routes`: o que o contrato do tenant com a SG libera (doc 12 §2). */
  routes: string[];
  /** Como o valor vai no header — descoberto na prática (doc 34 Q2). */
  headerMode: 'raw' | 'bearer';
  expiresAt: Date;
  /** Verdadeiro quando este token acabou de ser emitido (e não veio do cache). */
  novo: boolean;
}

export interface PedidoToken {
  conexao: SgConnectionContext & { isSgCloud: boolean; authPathOverride?: string | null };
  /** Só é chamado quando há renovação de verdade: a senha decifrada vive o mínimo possível. */
  credenciais: () => Promise<{ usuario: string; senha: string }>;
}

/**
 * Gerenciador de token por tenant (doc 12 §2).
 *
 * Três responsabilidades que precisam andar juntas:
 *  - **cache** no Redis, para não fazer login a cada chamada (o login é uma escrita no ERP);
 *  - **single-flight**: quando dez workers precisam do token ao mesmo tempo, apenas um autentica;
 *  - **descoberta do formato do header**: a documentação mostra o JWT puro, mas um exemplo usa
 *    `Bearer` (doc 34 Q2 sem resposta). Em vez de escolher no escuro, o produto tenta e aprende.
 *
 * O token nunca sai do backend e nunca vai para log — a redaction cobre `token`/`authorization`,
 * e aqui registramos apenas o resultado da renovação.
 */
@Injectable()
export class SgTokenManager {
  constructor(
    private readonly redis: RedisService,
    private readonly http: SgHttpClient,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SgTokenManager.name);
  }

  async getToken(pedido: PedidoToken): Promise<TokenSg> {
    const tenantId = pedido.conexao.tenantId;

    const emCache = await this.lerCache(tenantId);
    if (emCache) return emCache;

    // Single-flight: quem pegar o lock autentica; os demais esperam o resultado dele.
    const lock = await this.redis.client.set(this.chaveLock(tenantId), '1', 'EX', TTL_LOCK_S, 'NX');
    if (!lock) return this.esperarToken(tenantId, pedido);

    try {
      return await this.autenticar(pedido);
    } finally {
      await this.redis.client.del(this.chaveLock(tenantId));
    }
  }

  /** Descarta o token cacheado (401 no meio do uso, troca de senha, teste de conexão). */
  async invalidate(tenantId: string): Promise<void> {
    await this.redis.client.del(this.chaveToken(tenantId));
  }

  /**
   * Autentica de fato. Tenta o formato de header configurado e, em 401 de rota logo depois,
   * o outro formato — é assim que a pergunta Q2 se resolve sozinha por instalação.
   */
  private async autenticar(pedido: PedidoToken): Promise<TokenSg> {
    const { conexao } = pedido;
    const { usuario, senha } = await pedido.credenciais();
    const caminho =
      conexao.authPathOverride?.trim() || (conexao.isSgCloud ? AUTH_PATH_CLOUD : AUTH_PATH);

    let resposta;
    try {
      resposta = await this.http.request(
        { ...conexao, token: undefined },
        {
          method: 'POST',
          path: caminho,
          body: { usuario, senha },
          autorizacao: true,
          prioridade: 'interativo',
        },
      );
    } catch (erro) {
      this.metrics.sgTokenRefreshTotal.inc({
        tenant: conexao.tenantId,
        result: erro instanceof SgError ? erro.falha : 'erro',
      });
      throw erro;
    }

    const parsed = autorizacaoResponseSchema.safeParse(resposta.corpo);
    if (!parsed.success) {
      this.metrics.sgTokenRefreshTotal.inc({
        tenant: conexao.tenantId,
        result: 'resposta_invalida',
      });
      throw new SgError('resposta_invalida', {
        endpoint: caminho,
        mensagemOrigem: 'autorização respondeu fora do contrato',
      });
    }

    const token: TokenSg = {
      token: parsed.data.token,
      routes: parsed.data.routes,
      headerMode: conexao.authHeaderMode,
      expiresAt: new Date(Date.now() + TTL_CACHE_S * 1000),
      novo: true,
    };

    await this.gravarCache(conexao.tenantId, token);
    this.metrics.sgTokenRefreshTotal.inc({ tenant: conexao.tenantId, result: 'ok' });
    this.logger.info(
      {
        event: 'sg_token_refreshed',
        tenant_id: conexao.tenantId,
        rotas: token.routes.length,
        headerMode: token.headerMode,
      },
      'sg_token_refreshed',
    );

    return token;
  }

  /** Registra que o formato do header mudou — o serviço de conexão persiste a descoberta. */
  async registrarHeaderMode(tenantId: string, headerMode: 'raw' | 'bearer'): Promise<void> {
    const atual = await this.lerCache(tenantId);
    if (!atual) return;
    await this.gravarCache(tenantId, { ...atual, headerMode });
  }

  private async esperarToken(tenantId: string, pedido: PedidoToken): Promise<TokenSg> {
    for (let tentativa = 0; tentativa < 40; tentativa += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const token = await this.lerCache(tenantId);
      if (token) return token;
    }

    // Quem tinha o lock não concluiu (caiu, travou): tenta você mesmo em vez de falhar.
    this.logger.warn(
      { event: 'sg_token_lock_timeout', tenant_id: tenantId },
      'sg_token_lock_timeout',
    );
    return this.autenticar(pedido);
  }

  private async lerCache(tenantId: string): Promise<TokenSg | null> {
    const bruto = await this.redis.client.get(this.chaveToken(tenantId));
    if (!bruto) return null;

    try {
      const dados = JSON.parse(bruto) as Omit<TokenSg, 'expiresAt' | 'novo'> & {
        expiresAt: string;
      };
      return { ...dados, expiresAt: new Date(dados.expiresAt), novo: false };
    } catch {
      await this.invalidate(tenantId);
      return null;
    }
  }

  private async gravarCache(tenantId: string, token: TokenSg): Promise<void> {
    const restanteMs = token.expiresAt.getTime() - Date.now();
    const ttl = Math.max(30, Math.floor(restanteMs / 1000));
    await this.redis.client.set(this.chaveToken(tenantId), JSON.stringify(token), 'EX', ttl);
  }

  private chaveToken = (tenantId: string) => `sgtoken:${tenantId}`;
  private chaveLock = (tenantId: string) => `sgtoken:lock:${tenantId}`;
}
