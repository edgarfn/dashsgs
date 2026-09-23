import Link from 'next/link';
import { Alert } from '@/components/ui';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';

export const metadata = { title: 'Relatório de break-glass — DashSGS' };
export const dynamic = 'force-dynamic';

interface Relatorio {
  concessao: {
    id: string;
    tenantSlug: string;
    tenantName: string;
    ticket: string;
    justificativa: string;
    papel: string;
    status: string;
    solicitante: { nome: string; email: string };
    aprovador: { nome: string } | null;
    criadaEm: string;
    aprovadaEm: string | null;
    expiraEm: string | null;
    revogadaEm: string | null;
    acessos: number;
  };
  acessos: Array<{ quando: string; rota: string; ip: string | null }>;
}

const quando = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

/**
 * O anexo do ticket (runbook 22 §11, passo 3): o que foi acessado, na ordem, com hora e origem.
 *
 * Esta página é o que transforma "acesso auditado" de promessa em documento — dá para colar no
 * chamado e mandar para o cliente que perguntar.
 */
export default async function RelatorioBreakGlassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireMe();
  const { id } = await params;
  const resposta = await apiRequest<Relatorio>(
    'GET',
    `/platform/break-glass/${encodeURIComponent(id)}/relatorio`,
  );

  if (!me.user.platformAdmin || resposta.status === 404) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-app-fg">Página não encontrada</h1>
        <Link href="/" className="text-sm text-app-accent underline-offset-4 hover:underline">
          Voltar para a home
        </Link>
      </main>
    );
  }

  if (!resposta.ok || !resposta.data) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-app-fg">Relatório indisponível</h1>
        <Alert kind="error">Não foi possível carregar o relatório desta concessão.</Alert>
      </main>
    );
  }

  const { concessao, acessos } = resposta.data;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-1">
        <Link
          href="/plataforma/break-glass"
          className="text-xs uppercase tracking-[0.2em] text-app-muted hover:text-app-fg"
        >
          DashSGS · break-glass
        </Link>
        <h1 className="text-2xl font-semibold text-app-fg">
          {concessao.ticket} · {concessao.tenantSlug}
        </h1>
        <p className="text-sm text-app-muted">{concessao.justificativa}</p>
      </header>

      <section className="grid gap-4 rounded-xl border border-app-border bg-app-surface p-6 text-sm sm:grid-cols-2">
        <p className="text-app-muted">
          Solicitante:{' '}
          <span className="text-app-fg">
            {concessao.solicitante.nome} ({concessao.solicitante.email})
          </span>
        </p>
        <p className="text-app-muted">
          Aprovador: <span className="text-app-fg">{concessao.aprovador?.nome ?? '—'}</span>
        </p>
        <p className="text-app-muted">
          Papel: <span className="text-app-fg">{concessao.papel}</span>
        </p>
        <p className="text-app-muted">
          Situação: <span className="text-app-fg">{concessao.status}</span>
        </p>
        <p className="text-app-muted">
          Aberto em:{' '}
          <span className="text-app-fg">{quando.format(new Date(concessao.criadaEm))}</span>
        </p>
        <p className="text-app-muted">
          Fim:{' '}
          <span className="text-app-fg">
            {concessao.revogadaEm
              ? `${quando.format(new Date(concessao.revogadaEm))} (revogado)`
              : concessao.expiraEm
                ? quando.format(new Date(concessao.expiraEm))
                : '—'}
          </span>
        </p>
      </section>

      <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">
          Acessos ({acessos.length})
        </h2>

        {acessos.length === 0 ? (
          <p className="text-sm text-app-muted">
            Nenhuma requisição a dado do cliente foi feita sob esta concessão.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-app-muted">
                <tr>
                  <th className="py-2 pr-4">Quando</th>
                  <th className="py-2 pr-4">Rota</th>
                  <th className="py-2">Origem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {acessos.map((acesso, indice) => (
                  <tr key={`${acesso.quando}-${indice}`}>
                    <td className="py-2 pr-4 tabular-nums text-app-fg">
                      {quando.format(new Date(acesso.quando))}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-app-muted">{acesso.rota}</td>
                    <td className="py-2 font-mono text-xs text-app-muted">{acesso.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
