import Link from 'next/link';
import { Alert } from '@/components/ui';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';
import { AprovarForm, RevogarForm, SolicitarForm } from './forms';

export const metadata = { title: 'Break-glass — DashSGS' };
export const dynamic = 'force-dynamic';

interface Concessao {
  id: string;
  tenantId: string;
  tenantSlug: string;
  ticket: string;
  justificativa: string;
  papel: string;
  status: 'aguardando_aprovacao' | 'ativa' | 'expirada' | 'revogada';
  solicitante: { id: string; nome: string; email: string };
  aprovador: { id: string; nome: string } | null;
  criadaEm: string;
  expiraEm: string | null;
  acessos: number;
}

const quando = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const SELO: Record<Concessao['status'], { texto: string; classe: string }> = {
  aguardando_aprovacao: {
    texto: 'aguardando 2ª pessoa',
    classe: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
  },
  ativa: { texto: 'ativa', classe: 'bg-rose-500/10 text-rose-300 ring-rose-500/30' },
  expirada: { texto: 'expirada', classe: 'bg-white/5 text-slate-400 ring-white/10' },
  revogada: { texto: 'revogada', classe: 'bg-white/5 text-slate-400 ring-white/10' },
};

/**
 * Break-glass (E9-03) — runbook 22 §11 com botões.
 *
 * A tela mostra o processo inteiro porque é o processo que protege o cliente: pedido com motivo,
 * aprovação de outra pessoa, prazo curto e contagem de acessos. Uma concessão ativa aparece em
 * vermelho de propósito — é um estado que deveria durar minutos, não dias.
 */
export default async function BreakGlassPage() {
  const me = await requireMe();
  const [concessoes, tenants] = await Promise.all([
    apiRequest<Concessao[]>('GET', '/platform/break-glass'),
    apiRequest<Array<{ id: string; slug: string }>>('GET', '/platform/tenants'),
  ]);

  if (!me.user.platformAdmin || concessoes.status === 404) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-white">Página não encontrada</h1>
        <Link href="/" className="text-sm text-sky-300 underline-offset-4 hover:underline">
          Voltar para a home
        </Link>
      </main>
    );
  }

  if (concessoes.status === 401) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-white">Verificação necessária</h1>
        <Alert kind="info">
          Esta área exige verificação em duas etapas recente. Entre novamente para continuar.
        </Alert>
      </main>
    );
  }

  const lista = concessoes.data ?? [];
  const ativas = lista.filter((concessao) => concessao.status === 'ativa');

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-1">
        <Link
          href="/plataforma"
          className="text-xs uppercase tracking-[0.2em] text-slate-500 hover:text-slate-300"
        >
          DashSGS · operação
        </Link>
        <h1 className="text-2xl font-semibold text-white">Break-glass</h1>
        <p className="text-sm text-slate-400">
          Acesso excepcional a dados de um cliente. Quem pede não aprova; o owner é avisado por
          e-mail; o acesso expira sozinho e cada requisição vira linha de relatório.
        </p>
      </header>

      {ativas.length > 0 ? (
        <Alert kind="error">
          {ativas.length} concessão(ões) ativa(s) neste momento. Revogue assim que o atendimento
          terminar — não espere o prazo.
        </Alert>
      ) : null}

      <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Concessões</h2>

        {lista.length === 0 ? (
          <p className="text-sm text-slate-400">
            Nenhum acesso excepcional foi pedido até hoje. É o número que se quer manter.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {lista.map((concessao) => (
              <li key={concessao.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-200">
                      {concessao.tenantSlug}{' '}
                      <span className="font-mono text-xs text-slate-500">{concessao.ticket}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {concessao.solicitante.nome} · papel {concessao.papel} ·{' '}
                      {quando.format(new Date(concessao.criadaEm))}
                      {concessao.expiraEm
                        ? ` · expira ${quando.format(new Date(concessao.expiraEm))}`
                        : ''}
                      {concessao.aprovador ? ` · aprovado por ${concessao.aprovador.nome}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{concessao.justificativa}</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${SELO[concessao.status].classe}`}
                  >
                    {SELO[concessao.status].texto}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href={`/plataforma/break-glass/${concessao.id}`}
                    className="text-xs text-sky-300 underline-offset-4 hover:underline"
                  >
                    Relatório ({concessao.acessos} acesso(s))
                  </Link>

                  {concessao.status === 'aguardando_aprovacao' &&
                  concessao.solicitante.id !== me.user.id ? (
                    <AprovarForm id={concessao.id} />
                  ) : null}

                  {concessao.status === 'aguardando_aprovacao' &&
                  concessao.solicitante.id === me.user.id ? (
                    <span className="text-xs text-slate-500">
                      Aguardando outra pessoa da equipe — você pediu, você não aprova.
                    </span>
                  ) : null}

                  {concessao.status === 'ativa' ? <RevogarForm id={concessao.id} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
          Pedir acesso
        </h2>
        <SolicitarForm tenants={tenants.data ?? []} />
      </section>
    </main>
  );
}
