import Link from 'next/link';
import { Alert } from '@/components/ui';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';
import { ExecutarRetencaoForm } from './forms';

export const metadata = { title: 'Retenção — DashSGS' };
export const dynamic = 'force-dynamic';

interface Painel {
  politicas: Array<{
    id: string;
    tabela: string;
    escopo: 'identidade' | 'tenant';
    origem: string;
    motivo: string;
  }>;
  pendencias: Array<{
    politica: string;
    tabela: string;
    prazo: string;
    corte: string;
    pendentes: number;
    origem: string;
  }>;
  offboardingPendente: Array<{ id: string; slug: string; deletedAt: string }>;
}

const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

/**
 * Retenção (E6-04) — a matriz do doc 10 §2 com o placar de hoje.
 *
 * A tela existe para responder uma pergunta que um cliente, um auditor ou o DPO pode fazer a
 * qualquer momento: "vocês apagam mesmo o que prometem apagar?". A resposta certa é uma coluna
 * inteira de zeros — qualquer número diferente disso é dívida aberta, com nome e tabela.
 */
export default async function RetencaoPage() {
  const me = await requireMe();
  const painel = await apiRequest<Painel>('GET', '/platform/retencao');

  if (!me.user.platformAdmin || painel.status === 404) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-app-fg">Página não encontrada</h1>
        <Link href="/" className="text-sm text-app-accent underline-offset-4 hover:underline">
          Voltar para a home
        </Link>
      </main>
    );
  }

  if (painel.status === 401) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-app-fg">Verificação necessária</h1>
        <Alert kind="info">
          Esta área exige verificação em duas etapas recente. Entre novamente para continuar.
        </Alert>
      </main>
    );
  }

  const dados = painel.data;
  const pendencias = dados?.pendencias ?? [];
  const emAtraso = pendencias.filter((linha) => linha.pendentes > 0);
  const motivoDe = new Map(dados?.politicas.map((p) => [p.id, p.motivo]) ?? []);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-6 py-12">
      <header className="space-y-1">
        <Link
          href="/plataforma"
          className="text-xs uppercase tracking-[0.2em] text-app-muted hover:text-app-fg"
        >
          DashSGS · operação
        </Link>
        <h1 className="text-2xl font-semibold text-app-fg">Retenção e descarte</h1>
        <p className="text-sm text-app-muted">
          {pendencias.length} política(s) do doc 10 §2 executadas todo dia às 3h20. A purga roda
          sozinha; o botão abaixo só antecipa.
        </p>
      </header>

      {emAtraso.length === 0 ? (
        <Alert kind="success">
          Nada fora da retenção. É este o estado correto — e é ele que se mostra a um auditor.
        </Alert>
      ) : (
        <Alert kind="error">
          {emAtraso.length} política(s) com dado além do prazo. Execute a purga e, se o número não
          zerar, a política não está sendo cumprida.
        </Alert>
      )}

      <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">Políticas</h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-app-muted">
              <tr>
                <th className="py-2 pr-4">Dado</th>
                <th className="py-2 pr-4">Tabela</th>
                <th className="py-2 pr-4">Prazo</th>
                <th className="py-2 pr-4">Corte</th>
                <th className="py-2 pr-4 text-right">Fora do prazo</th>
                <th className="py-2">Origem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border">
              {pendencias.map((linha) => (
                <tr key={linha.politica} className="align-top">
                  <td className="py-3 pr-4">
                    <p className="text-app-fg">{linha.politica.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-app-muted">{motivoDe.get(linha.politica)}</p>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-app-muted">{linha.tabela}</td>
                  <td className="py-3 pr-4 text-app-fg">{linha.prazo}</td>
                  <td className="py-3 pr-4 tabular-nums text-app-muted">
                    {data.format(new Date(linha.corte))}
                  </td>
                  <td
                    className={`py-3 pr-4 text-right tabular-nums ${
                      linha.pendentes > 0 ? 'text-app-danger' : 'text-app-muted'
                    }`}
                  >
                    {linha.pendentes}
                  </td>
                  <td className="py-3 text-xs text-app-muted">{linha.origem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ExecutarRetencaoForm />
      </section>

      <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">
          Offboarding aguardando purga física
        </h2>

        {(dados?.offboardingPendente ?? []).length === 0 ? (
          <p className="text-sm text-app-muted">
            Nenhum contrato desligado passou da carência de 30 dias (doc 08 §5).
          </p>
        ) : (
          <ul className="divide-y divide-app-border text-sm">
            {(dados?.offboardingPendente ?? []).map((tenant) => (
              <li key={tenant.id} className="flex justify-between gap-3 py-3">
                <span className="font-mono text-xs text-app-fg">{tenant.slug}</span>
                <span className="text-xs text-app-muted">
                  desligado em {data.format(new Date(tenant.deletedAt))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
