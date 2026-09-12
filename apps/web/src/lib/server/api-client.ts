import 'server-only';
import { CORRELATION_ID_HEADER, CSRF_HEADER, type ApiErrorBody } from '@dashsgs/shared';
import { cookies, headers } from 'next/headers';
import { getWebEnv } from './env';

/**
 * Cliente da API interna usado pelos Server Actions e Server Components.
 *
 * O navegador nunca fala com a API: ele fala com o Next, que repassa a requisição com os cookies
 * de sessão e o token anti-CSRF, e devolve ao navegador os cookies que a API emitir. É o padrão
 * BFF do doc 04 §1 — o token de sessão nunca passa por JavaScript de página.
 */

export const SESSION_COOKIE = 'dashsgs_session';
export const CSRF_COOKIE = 'dashsgs_csrf';

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

  try {
    const response = await fetch(`${env.internalApiUrl}/api/v1${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;

    return {
      ok: response.ok,
      status: response.status,
      data: response.ok ? (payload as T) : null,
      error: response.ok ? null : (payload as ApiErrorBody),
      setCookies: response.headers.getSetCookie?.() ?? [],
    };
  } catch {
    // Detalhe fica no log do servidor; a tela mostra estado de erro (doc 16 §3).
    return {
      ok: false,
      status: 0,
      data: null,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Não foi possível falar com o servidor. Tente novamente.',
        correlationId: correlationId ?? 'desconhecido',
        timestamp: new Date().toISOString(),
      },
      setCookies: [],
    };
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
