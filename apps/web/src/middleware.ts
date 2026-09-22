import { CORRELATION_ID_HEADER } from '@dashsgs/shared';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware de borda do front (doc 09 §1):
 *  - gera o nonce da CSP por requisição (sem `unsafe-inline` — E9-02 fecha o ciclo na Fase 9);
 *  - garante um id de correlação, que segue para a API e volta nos logs dos dois lados;
 *  - manda para o login quem chega sem cookie de sessão.
 *
 * O redirecionamento aqui é conveniência de navegação, **não** é autorização: quem decide é o
 * backend, a cada requisição (doc 07 §1). Um cookie forjado não abre nada.
 */

/** Rotas alcançáveis sem sessão. */
const PUBLIC_PATHS = ['/entrar', '/esqueci-senha', '/redefinir-senha', '/convite'];
/** Rotas do fluxo de MFA: exigem cookie, mas a sessão ainda é parcial. */
const MFA_PATHS = ['/mfa'];

// Mesmo prefixo `__Host-` que a API usa em produção (doc 06 §Estratégia) — sem isto, o cookie
// que o navegador de fato tem (`__Host-dashsgs_session`) nunca bate com o nome procurado aqui.
const SESSION_COOKIE =
  process.env.NODE_ENV === 'production' ? '__Host-dashsgs_session' : 'dashsgs_session';

export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const correlationId = request.headers.get(CORRELATION_ID_HEADER) ?? crypto.randomUUID();
  const isDev = process.env.NODE_ENV === 'development';
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const isMfa = MFA_PATHS.some((path) => pathname.startsWith(path));
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

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

  const apply = (response: NextResponse): NextResponse => {
    response.headers.set('Content-Security-Policy', csp);
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    return response;
  };

  if (!hasSession && !isPublic && !isMfa) {
    const destino = new URL('/entrar', request.url);
    if (pathname !== '/') destino.searchParams.set('expirada', '1');
    return apply(NextResponse.redirect(destino));
  }

  // Deliberadamente NÃO redirecionamos "/entrar" para a home quando existe cookie: cookie
  // presente não é sessão válida (pode estar revogada ou expirada). Fazer isso criaria um laço
  // — a home manda para o login, o login manda para a home — justamente para quem já está com
  // problema de sessão. Quem tem sessão boa e abre /entrar apenas entra de novo.
  return apply(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  // Assets estáticos não precisam de CSP dinâmica nem de correlação.
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico).*)' }],
};
