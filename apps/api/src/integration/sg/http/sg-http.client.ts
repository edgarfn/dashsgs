import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { AppConfigService } from '../../../config';
import { classificarResposta, erroDeRede, SgError } from '../sg-errors';
import { SgCircuitBreaker, type EstadoCircuito } from './sg-circuit-breaker';
import { SgRateLimiter, type PrioridadeChamada } from './sg-rate-limiter';
import { assertSafeErpUrl } from './url-guard';

/** Dados da conexão que o cliente precisa — nada de segredo persistente aqui. */
export interface SgConnectionContext {
  tenantId: string;
  baseUrl: string;
  tlsMode: 'https' | 'vpn';
  maxRps: number;
  /** JWT já obtido pelo token manager. Ausente apenas na própria autorização. */
  token?: string;
  authHeaderMode: 'raw' | 'bearer';
}

export interface SgRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Caminho a partir da base, ex.: `/integracao/sgsistemas/v1/filiais`. */
  path: string;
  query?: Record<string, string | number | boolean | undefined | null | Array<string | number>>;
  body?: unknown;
  /** Endpoints com cálculo pesado (PIS/COFINS, custo sem encargos) usam o timeout longo. */
  pesado?: boolean;
  prioridade?: PrioridadeChamada;
  /** Marca a chamada como a própria autorização (muda a classificação do 401). */
  autorizacao?: boolean;
  /** Segunda tentativa após renovar o token — 401 aqui significa rota não contratada. */
  segundaTentativa?: boolean;
}

export interface SgResposta {
  status: number;
  corpo: unknown;
  /** Tempo até a resposta chegar, sem contar espera de rate limit. */
  duracaoMs: number;
}

/** Transporte HTTP — abstraído para que o modo mock sirva fixtures sem tocar na rede. */
export interface SgTransport {
  fetch(url: string, init: RequestInit): Promise<Response>;
}

export const SG_TRANSPORT = Symbol('SG_TRANSPORT');

const RETRIES_GET = 3;
/** Backoff do doc 12 §3: 1 s → 4 s → 9 s, com jitter para não sincronizar tentativas. */
const backoffMs = (tentativa: number): number =>
  tentativa * tentativa * 1000 + Math.floor(Math.random() * 400);

/**
 * Cliente HTTP da API SG: política única de timeout, retry, rate limit e disjuntor (doc 12 §3).
 *
 * Duas regras que não se negociam aqui:
 *  - **GET repete, escrita não.** A API não tem idempotência (doc 02 §3): repetir um POST pode
 *    duplicar pedido, oferta ou baixa financeira. Reprocesso de escrita é manual e verificado.
 *  - **O endereço é revalidado a cada chamada** (anti-SSRF/DNS rebinding), não só no cadastro.
 */
@Injectable()
export class SgHttpClient {
  constructor(
    private readonly circuito: SgCircuitBreaker,
    private readonly rateLimiter: SgRateLimiter,
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
    @Inject(SG_TRANSPORT) private readonly transport: SgTransport,
  ) {
    this.logger.setContext(SgHttpClient.name);
  }

  async request(contexto: SgConnectionContext, opcoes: SgRequestOptions): Promise<SgResposta> {
    const endpoint = rotuloEndpoint(opcoes.path);
    const podeRepetir = opcoes.method === 'GET';
    const tentativasMax = podeRepetir ? RETRIES_GET : 1;

    let ultimoErro: SgError | null = null;

    for (let tentativa = 1; tentativa <= tentativasMax; tentativa += 1) {
      const estado = await this.circuito.guard(contexto.tenantId, endpoint);
      this.reportarCircuito(contexto.tenantId, estado);

      const limite = await this.rateLimiter.acquire(
        contexto.tenantId,
        contexto.maxRps,
        opcoes.prioridade ?? 'interativo',
      );
      if (limite.desistiu) {
        throw new SgError('inalcancavel', {
          endpoint,
          mensagemOrigem: 'fila do self-rate-limit excedeu o tempo aceitável',
        });
      }

      const inicio = Date.now();
      try {
        const resposta = await this.executar(contexto, opcoes);
        const duracaoMs = Date.now() - inicio;

        this.metrics.observeSgCall({
          tenantId: contexto.tenantId,
          endpoint,
          status: resposta.status,
          durationSeconds: duracaoMs / 1000,
          esperaSegundos: limite.esperaMs / 1000,
        });

        if (resposta.status >= 200 && resposta.status < 300) {
          await this.circuito.onSuccess(contexto.tenantId);
          this.reportarCircuito(contexto.tenantId, 'fechado');
          return { ...resposta, duracaoMs };
        }

        const erro = classificarResposta(resposta.status, resposta.corpo, {
          endpoint,
          autorizacao: opcoes.autorizacao,
          segundaTentativa: opcoes.segundaTentativa,
        });

        // Só falha de infraestrutura conta para o disjuntor: 401 e 400 são problema de
        // contrato ou de código nosso, e abrir o circuito por isso esconderia o defeito.
        if (erro.retentavel) {
          this.reportarCircuito(
            contexto.tenantId,
            await this.circuito.onFailure(contexto.tenantId, estado),
          );
        }

        if (!erro.retentavel || !podeRepetir || tentativa === tentativasMax) throw erro;
        ultimoErro = erro;
      } catch (causa) {
        const erro = causa instanceof SgError ? causa : erroDeRede(causa, endpoint);

        if (!(causa instanceof SgError)) {
          this.metrics.observeSgCall({
            tenantId: contexto.tenantId,
            endpoint,
            status: 'rede',
            durationSeconds: (Date.now() - inicio) / 1000,
            esperaSegundos: limite.esperaMs / 1000,
          });
          this.reportarCircuito(
            contexto.tenantId,
            await this.circuito.onFailure(contexto.tenantId, estado),
          );
        }

        if (!erro.retentavel || !podeRepetir || tentativa === tentativasMax) throw erro;
        ultimoErro = erro;
      }

      const espera = backoffMs(tentativa);
      this.logger.warn(
        {
          event: 'sg_retry',
          tenant_id: contexto.tenantId,
          endpoint,
          tentativa,
          esperaMs: espera,
          falha: ultimoErro?.falha,
        },
        'sg_retry',
      );
      await new Promise((resolve) => setTimeout(resolve, espera));
    }

    throw ultimoErro ?? new SgError('inalcancavel', { endpoint });
  }

  private async executar(
    contexto: SgConnectionContext,
    opcoes: SgRequestOptions,
  ): Promise<{ status: number; corpo: unknown }> {
    // Revalidação a cada chamada: o DNS pode ter mudado desde o cadastro (rebinding).
    const { url } = await assertSafeErpUrl(contexto.baseUrl, {
      tlsMode: contexto.tlsMode,
      allowInsecure: this.config.sg.allowInsecure,
      vpnCidr: this.config.sg.vpnCidr,
    });

    const alvo = new URL(opcoes.path, url);
    for (const [chave, valor] of Object.entries(opcoes.query ?? {})) {
      if (valor === undefined || valor === null || valor === '') continue;
      if (Array.isArray(valor)) {
        // Filtros de lista (`filiais`, `situacoes`) vão repetidos, como na coleção oficial.
        for (const item of valor) alvo.searchParams.append(chave, String(item));
      } else {
        alvo.searchParams.set(chave, String(valor));
      }
    }

    const timeout = opcoes.pesado ? this.config.sg.heavyTimeoutMs : this.config.sg.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const resposta = await this.transport.fetch(alvo.toString(), {
        method: opcoes.method,
        headers: this.montarHeaders(contexto, opcoes),
        body: opcoes.body === undefined ? undefined : JSON.stringify(opcoes.body),
        signal: controller.signal,
        // Redirecionamento é vetor de SSRF: o destino final escaparia da validação.
        redirect: 'error',
      });

      const texto = await resposta.text();
      let corpo: unknown = null;
      try {
        corpo = texto ? JSON.parse(texto) : null;
      } catch {
        corpo = { error: texto.slice(0, 200) };
      }

      return { status: resposta.status, corpo };
    } finally {
      clearTimeout(timer);
    }
  }

  private montarHeaders(
    contexto: SgConnectionContext,
    opcoes: SgRequestOptions,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'DashSGS/1.0 (integração)',
    };

    if (opcoes.body !== undefined) headers['Content-Type'] = 'application/json';

    if (contexto.token) {
      // A coleção mostra o JWT puro; um request declara "bearer" (doc 02 §2, doc 34 Q2).
      // O modo fica na conexão e é descoberto na prática, com fallback no token manager.
      headers.Authorization =
        contexto.authHeaderMode === 'bearer' ? `Bearer ${contexto.token}` : contexto.token;
    }

    return headers;
  }

  private reportarCircuito(tenantId: string, estado: EstadoCircuito): void {
    const valor = estado === 'fechado' ? 0 : estado === 'meio-aberto' ? 1 : 2;
    this.metrics.setSgCircuitState(tenantId, valor);
  }
}

/** Rótulo estável para métrica: sem ids, para não explodir a cardinalidade (doc 18 §2). */
export function rotuloEndpoint(path: string): string {
  return (
    path
      .replace(/\/integracao\/sgsistemas\/v1/, '')
      .replace(/\/\d+/g, '/:id')
      .replace(/\/+$/, '') || '/'
  );
}
