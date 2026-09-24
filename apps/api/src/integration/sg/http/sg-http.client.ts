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
  /**
   * Prefixo aplicado a TODAS as rotas deste tenant (doc 34 Q5).
   *
   * Ausente = herda o padrão da instalação (`SG_API_PATH_PREFIX`), que por sua vez nasce vazio.
   * É a resposta da SG sobre o `/public` do SG Cloud morando em dado, não em código.
   */
  apiPathPrefix?: string | null;
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
 * Teto da espera entre tentativas, mesmo quando o servidor pede mais.
 *
 * `Retry-After: 3600` existe e é legal; respeitá-lo ao pé da letra prenderia um worker por uma
 * hora segurando o lock do domínio. Acima deste teto a resposta honesta é falhar e deixar a
 * cadência reagendar (doc 14 §5).
 */
const ESPERA_MAXIMA_MS = 60_000;

/**
 * `Retry-After` em segundos ou como data HTTP (RFC 9110 §10.2.3). Valor ausente, negativo ou
 * ilegível vira `undefined` — o backoff normal assume.
 */
/**
 * Aplica o prefixo da API a um caminho (doc 34 Q5).
 *
 * Idempotente: caminho que já vem prefixado — a autorização do SG Cloud, que carrega `/public`
 * na própria constante — não recebe o prefixo duas vezes. Sem isso, ligar o prefixo global
 * transformaria `/public/...` em `/public/public/...` e a autorização pararia de funcionar
 * justamente na instalação que precisava do ajuste.
 */
export function aplicarPrefixo(caminho: string, prefixoBruto: string | null | undefined): string {
  const prefixo = (prefixoBruto ?? '').replace(/\/+$/, '');
  if (!prefixo) return caminho;
  if (caminho === prefixo || caminho.startsWith(`${prefixo}/`)) return caminho;
  return `${prefixo}${caminho.startsWith('/') ? '' : '/'}${caminho}`;
}

export function lerRetryAfter(bruto: string | null): number | undefined {
  if (!bruto) return undefined;

  const segundos = Number(bruto.trim());
  if (Number.isFinite(segundos)) return segundos > 0 ? segundos * 1000 : undefined;

  const instante = Date.parse(bruto);
  if (Number.isNaN(instante)) return undefined;

  const espera = instante - Date.now();
  return espera > 0 ? espera : undefined;
}

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
    // O prefixo entra aqui, antes do rótulo, e não só na hora de montar a URL: é ele que
    // distingue `/autorizacao` de `/public/autorizacao`, e essa é exatamente a diferença entre
    // "rota fora do contrato" e "cadastro apontando para um caminho que não existe nesta
    // instalação". Sem isso, o 404 de corpo vazio chega ao operador como `nao_encontrado` puro.
    // `aplicarPrefixo` é idempotente, então `executar` pode reaplicá-lo sem duplicar.
    const caminho = this.comPrefixo(contexto, opcoes.path);
    const endpoint = rotuloEndpoint(caminho);
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
          retryAfterMs: resposta.retryAfterMs,
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

      // Quando o servidor diz quanto esperar, ele sabe melhor que o nosso backoff: só não o
      // deixamos encurtar a espera nem segurar a fila indefinidamente (doc 34 Q3).
      const sugerida = ultimoErro?.esperaSugeridaMs ?? null;
      const espera =
        sugerida === null
          ? backoffMs(tentativa)
          : Math.min(Math.max(sugerida, backoffMs(tentativa)), ESPERA_MAXIMA_MS);
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

  /**
   * Aplica o prefixo da API ao caminho (doc 34 Q5).
   *
   * O prefixo do tenant vence o da instalação; string vazia é uma escolha válida e explícita
   * ("esta instalação não usa prefixo"), por isso a checagem é por `null`/`undefined` e não por
   * valor falso — `?? ` e não `||`.
   */
  private comPrefixo(contexto: SgConnectionContext, caminho: string): string {
    return aplicarPrefixo(caminho, contexto.apiPathPrefix ?? this.config.sg.apiPathPrefix);
  }

  private async executar(
    contexto: SgConnectionContext,
    opcoes: SgRequestOptions,
  ): Promise<{ status: number; corpo: unknown; retryAfterMs?: number }> {
    // Revalidação a cada chamada: o DNS pode ter mudado desde o cadastro (rebinding).
    const { url } = await assertSafeErpUrl(contexto.baseUrl, {
      tlsMode: contexto.tlsMode,
      allowInsecure: this.config.sg.allowInsecure,
      vpnCidrs: this.config.sg.vpnCidrs,
    });

    const alvo = new URL(this.comPrefixo(contexto, opcoes.path), url);
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

      return {
        status: resposta.status,
        corpo,
        retryAfterMs: lerRetryAfter(resposta.headers.get('retry-after')),
      };
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
