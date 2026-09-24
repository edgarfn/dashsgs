import 'server-only';
import { CORRELATION_ID_HEADER, CSRF_HEADER, type ApiErrorBody } from '@dashsgs/shared';
import { cookies, headers } from 'next/headers';
import { getWebEnv, isWebProduction } from './env';
import { logServidor } from './log';

/**
 * Cliente da API interna usado pelos Server Actions e Server Components.
 *
 * O navegador nunca fala com a API: ele fala com o Next, que repassa a requisição com os cookies
 * de sessão e o token anti-CSRF, e devolve ao navegador os cookies que a API emitir. É o padrão
 * BFF do doc 04 §1 — o token de sessão nunca passa por JavaScript de página.
 */

// Mesmo prefixo `__Host-` que a API usa em produção (doc 06 §Estratégia) — sem isto, o cookie
// que o navegador de fato tem (`__Host-dashsgs_session`) nunca bate com o nome procurado aqui.
const isProduction = isWebProduction();

export const SESSION_COOKIE = isProduction ? '__Host-dashsgs_session' : 'dashsgs_session';
export const CSRF_COOKIE = isProduction ? '__Host-dashsgs_csrf' : 'dashsgs_csrf';

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: ApiErrorBody | null;
  /** Cookies emitidos pela API, ainda no formato bruto do header. */
  setCookies: string[];
}

interface RequestOptions {
  /** Envia os cookies do navegador (padrão) ou faz uma chamada anônima. */
  authenticated?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Teto para as rotas que falam com o ERP **dentro** do request (hoje só o teste de conexão).
 *
 * O orçamento da API para uma chamada à SG é o `SG_HTTP_TIMEOUT_MS` (60 s por padrão), e o teste
 * faz duas em sequência — autorização e status. Com os 10 s do padrão daqui, o Next desistia
 * primeiro e devolvia "não foi possível falar com o servidor" enquanto a API terminava o teste e
 * gravava o resultado: a tela mostrava o erro e, ao lado, o cartão verde do teste que tinha dado
 * certo. Quem espera tem que esperar mais que quem trabalha, senão o erro é mentira.
 */
export const ERP_TIMEOUT_MS = 120_000;

/** Erro de rede do `fetch` do Node guarda o motivo real (ECONNREFUSED, ENOTFOUND…) em `cause`. */
function codigoDeRede(erro: unknown): string | null {
  const causa = erro instanceof Error ? (erro.cause as { code?: unknown } | undefined) : undefined;
  return typeof causa?.code === 'string' ? causa.code : null;
}

export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const env = getWebEnv();
  const { authenticated = true, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const requestHeaders: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';

  const correlationId = (await headers()).get(CORRELATION_ID_HEADER);
  if (correlationId) requestHeaders[CORRELATION_ID_HEADER] = correlationId;

  if (authenticated) {
    const jar = await cookies();
    const session = jar.get(SESSION_COOKIE)?.value;
    const csrf = jar.get(CSRF_COOKIE)?.value;
    const pairs = [
      session ? `${SESSION_COOKIE}=${session}` : null,
      csrf ? `${CSRF_COOKIE}=${csrf}` : null,
    ].filter(Boolean);

    if (pairs.length > 0) requestHeaders.Cookie = pairs.join('; ');
    // Mutação autenticada sempre leva o token double-submit (doc 09 §1).
    if (csrf && method !== 'GET') requestHeaders[CSRF_HEADER] = csrf;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const rota = `${method} ${path}`;
  const id = correlationId ?? 'desconhecido';
  const inicio = Date.now();

  const falha = (status: number, message: string): ApiResponse<T> => ({
    ok: false,
    status,
    data: null,
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message,
      correlationId: id,
      timestamp: new Date().toISOString(),
    },
    setCookies: [],
  });

  try {
    const response = await fetch(`${env.internalApiUrl}/api/v1${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    let payload: unknown = null;
    const text = await response.text();

    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        // Corpo que não é JSON quase nunca vem da API: é página de erro de proxy/gateway no meio
        // do caminho. O status é a informação que resolve — dizer "inalcançável" jogaria fora o
        // único dado útil que chegou.
        logServidor('error', {
          event: 'bff_resposta_nao_json',
          correlation_id: id,
          metodo: method,
          rota: path,
          status: response.status,
          duracao_ms: Date.now() - inicio,
          trecho: text.slice(0, 200),
        });

        return falha(
          response.status,
          `A API respondeu HTTP ${response.status} em ${rota} num formato que não é JSON — ` +
            `normalmente é um proxy respondendo no lugar dela. (id: ${id})`,
        );
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: response.ok ? (payload as T) : null,
      error: response.ok ? null : (payload as ApiErrorBody),
      setCookies: response.headers.getSetCookie?.() ?? [],
    };
  } catch (erro) {
    // Quem sabe se foi o nosso timeout é o nosso próprio signal, e não o nome do erro: neste
    // mesmo `catch` caem tanto `AbortError` quanto `TypeError: fetch failed` (falha de rede), e
    // o rótulo é detalhe de implementação do fetch. O signal é nosso e não depende disso.
    const expirou = controller.signal.aborted;
    const codigo = codigoDeRede(erro);

    logServidor('error', {
      event: expirou ? 'bff_timeout' : 'bff_falha_de_rede',
      correlation_id: id,
      metodo: method,
      rota: path,
      duracao_ms: Date.now() - inicio,
      timeout_ms: timeoutMs,
      causa: codigo ?? (erro instanceof Error ? erro.message : String(erro)),
    });

    // O endereço interno da API fica só no log: não ajuda quem está na tela e é topologia
    // nossa (doc 09 §1). Para o usuário vai o que ele consegue usar — o que falhou, quanto
    // tempo esperamos, o que fazer agora e o id que liga a tela à linha de log.
    if (expirou) {
      return falha(
        0,
        `O servidor não respondeu em ${Math.round(timeoutMs / 1000)}s a ${rota}. A operação pode ` +
          'ter continuado do lado de lá — recarregue a página para ver como ela terminou antes ' +
          `de tentar de novo. (id: ${id})`,
      );
    }

    return falha(
      0,
      `Não foi possível falar com a API em ${rota}${codigo ? ` (${codigo})` : ''}. ` +
        `Tente novamente. (id: ${id})`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Repassa ao navegador os cookies que a API emitiu (login, rotação de sessão, logout).
 * Sem isto a sessão criada na API ficaria presa no servidor do Next.
 */
export async function relaySetCookies(setCookies: string[]): Promise<void> {
  if (setCookies.length === 0) return;
  const jar = await cookies();

  for (const raw of setCookies) {
    const [pair, ...attributes] = raw.split(';');
    const separator = pair?.indexOf('=') ?? -1;
    if (!pair || separator < 0) continue;

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const flags = attributes.map((attribute) => attribute.trim().toLowerCase());
    const maxAgeFlag = flags.find((flag) => flag.startsWith('max-age='));
    const maxAge = maxAgeFlag ? Number(maxAgeFlag.split('=')[1]) : undefined;

    if (value === '' || maxAge === 0) {
      jar.delete(name);
      continue;
    }

    jar.set(name, value, {
      httpOnly: true,
      secure: flags.includes('secure'),
      sameSite: 'lax',
      path: '/',
      ...(maxAge !== undefined && Number.isFinite(maxAge) ? { maxAge } : {}),
    });
  }
}

/** Mensagem segura de erro para exibir num formulário. */
export function errorMessage(response: ApiResponse<unknown>, fallback: string): string {
  return response.error?.message ?? fallback;
}
