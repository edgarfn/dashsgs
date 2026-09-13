import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { CSRF_COOKIE, SESSION_COOKIE } from '@/lib/server/api-client';
import { getWebEnv } from '@/lib/server/env';

/**
 * Download do CSV de vendas pelo BFF (doc 04 §1).
 *
 * O navegador não fala com a API: ele pede o arquivo ao Next, que repassa a requisição com o
 * cookie de sessão. Sem esta rota, a única alternativa seria expor a API ao browser — e com ela
 * o token de sessão sairia do domínio do app.
 *
 * Nada é decidido aqui: quem autoriza é a API (`reports.export`). Esta rota só transporta, e
 * devolve o mesmo status que recebeu.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const env = getWebEnv();
  const jar = await cookies();

  const sessao = jar.get(SESSION_COOKIE)?.value;
  const csrf = jar.get(CSRF_COOKIE)?.value;

  const parametros = new URLSearchParams();
  for (const [chave, valor] of request.nextUrl.searchParams.entries()) {
    // Só os filtros da consulta seguem adiante — nada de repassar query arbitrária à API.
    if (['data', 'filiais', 'caixa', 'canceladas'].includes(chave)) parametros.set(chave, valor);
  }

  const resposta = await fetch(
    `${env.internalApiUrl}/api/v1/dashboard/vendas/dia/export?${parametros.toString()}`,
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
    // Erro volta como texto simples: é um download, não uma tela.
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
        resposta.headers.get('content-disposition') ?? 'attachment; filename="vendas.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
