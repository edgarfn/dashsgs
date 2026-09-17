import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { CSRF_COOKIE, SESSION_COOKIE } from '@/lib/server/api-client';
import { getWebEnv } from '@/lib/server/env';

/** Filtros que seguem para a API. Query fora desta lista é descartada, não repassada. */
const FILTROS = ['de', 'ate', 'acao', 'categoria', 'resultado', 'atorId', 'recursoTipo'];

/**
 * Download do CSV da trilha de auditoria pelo BFF (E6-01, doc 04 §1).
 *
 * Mesma mecânica do export de vendas: o navegador pede ao Next, que repassa com o cookie de
 * sessão. Nada é decidido aqui — quem autoriza é a API (`audit.view`), e é ela também que
 * registra o export na própria trilha.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const env = getWebEnv();
  const jar = await cookies();

  const sessao = jar.get(SESSION_COOKIE)?.value;
  const csrf = jar.get(CSRF_COOKIE)?.value;

  const parametros = new URLSearchParams();
  for (const [chave, valor] of request.nextUrl.searchParams.entries()) {
    if (FILTROS.includes(chave) && valor) parametros.set(chave, valor);
  }

  const resposta = await fetch(
    `${env.internalApiUrl}/api/v1/tenant/audit/export?${parametros.toString()}`,
    {
      headers: {
        Accept: 'text/csv',
        Cookie: [
          sessao ? `${SESSION_COOKIE}=${sessao}` : null,
          csrf ? `${CSRF_COOKIE}=${csrf}` : null,
        ]
          .filter(Boolean)
          .join('; '),
      },
      cache: 'no-store',
    },
  );

  if (!resposta.ok) {
    return new Response('Não foi possível gerar o arquivo.', {
      status: resposta.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(await resposta.text(), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition':
        resposta.headers.get('content-disposition') ?? 'attachment; filename="auditoria.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
