import { CORRELATION_ID_HEADER } from '@dashsgs/shared';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware de borda do front (doc 09 §1):
 *  - gera o nonce da CSP por requisição (sem `unsafe-inline` — E9-02 fecha o ciclo na Fase 9);
 *  - garante um id de correlação, que segue para a API e volta nos logs dos dois lados.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const correlationId = request.headers.get(CORRELATION_ID_HEADER) ?? crypto.randomUUID();
  const isDev = process.env.NODE_ENV === 'development';

  const csp = [
    "default-src 'self'",
    // O Next injeta scripts próprios; em dev ele também usa eval para o refresh rápido.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ''}`.trim(),
    `style-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ''}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(CORRELATION_ID_HEADER, correlationId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  return response;
}

export const config = {
  // Assets estáticos não precisam de CSP dinâmica nem de correlação.
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico).*)' }],
};
