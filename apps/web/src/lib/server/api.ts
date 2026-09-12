import 'server-only';
import { CORRELATION_ID_HEADER, type ReadinessBody } from '@dashsgs/shared';
import { headers } from 'next/headers';
import { getWebEnv } from './env';

/**
 * Cliente da API interna, **sempre** no servidor (doc 04 §2: o navegador nunca fala com o ERP,
 * e no MVP também não fala direto com a API — o Next é o BFF de borda).
 *
 * Propaga o id de correlação para que um clique no front e o log da API tenham o mesmo rastro.
 */
const DEFAULT_TIMEOUT_MS = 5_000;

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  correlationId: string | null;
}

export async function apiGet<T>(
  path: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ApiResult<T>> {
  const env = getWebEnv();
  const requestHeaders = await headers();
  const correlationId = requestHeaders.get(CORRELATION_ID_HEADER) ?? undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${env.internalApiUrl}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(correlationId ? { [CORRELATION_ID_HEADER]: correlationId } : {}),
      },
      signal: controller.signal,
      // Estado de saúde nunca é cacheado.
      cache: 'no-store',
    });

    const data = (await response.json().catch(() => null)) as T | null;
    return {
      ok: response.ok,
      status: response.status,
      data,
      correlationId: response.headers.get(CORRELATION_ID_HEADER),
    };
  } catch {
    // A causa detalhada fica no log do servidor; a página mostra estado degradado (doc 16 §3).
    return { ok: false, status: 0, data: null, correlationId: correlationId ?? null };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchReadiness(): Promise<ApiResult<ReadinessBody>> {
  return apiGet<ReadinessBody>('/readyz');
}
