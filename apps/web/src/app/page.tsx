import Link from 'next/link';
import type { DependencyHealth } from '@dashsgs/shared';
import { fetchReadiness } from '@/lib/server/api';
import { getWebEnv } from '@/lib/server/env';
import { requireMe } from '@/lib/server/session';
import { logoutAction } from './(auth)/actions';

export const dynamic = 'force-dynamic';

const STATE_STYLE: Record<string, string> = {
  ok: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  degraded: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
  down: 'bg-rose-500/10 text-rose-300 ring-rose-500/30',
};

const STATE_LABEL: Record<string, string> = {
  ok: 'operacional',
  degraded: 'degradado',
  down: 'indisponível',
};

function StateBadge({ state }: { state: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
        STATE_STYLE[state] ?? STATE_STYLE.down
      }`}
    >
      {STATE_LABEL[state] ?? 'desconhecido'}
    </span>
  );
}

function DependencyRow({ check }: { check: DependencyHealth }) {
  return (
    <li className="flex items-center justify-between gap-4 border-t border-white/5 py-3 first:border-t-0">
      <div>
        <p className="font-medium text-slate-200">{check.name}</p>
        {check.detail ? <p className="text-xs text-slate-400">{check.detail}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        {typeof check.latencyMs === 'number' ? (
          <span className="text-xs tabular-nums text-slate-400">{check.latencyMs} ms</span>
        ) : null}
        <StateBadge state={check.state} />
      </div>
    </li>
  );
}

/**
 * Home autenticada provisória (Fases 2–3).
 *
 * A Fase 7 substitui este conteúdo pela home executiva do doc 15; por enquanto ela prova que a
 * sessão funciona ponta a ponta e mostra o estado da plataforma.
 */
export default async function HomePage() {
  const me = await requireMe();
  const env = getWebEnv();
  const readiness = await fetchReadiness();
  const state = readiness.data?.state ?? 'down';
  const checks = readiness.data?.checks ?? [];
  const tenant = me.memberships.find((membership) => membership.tenantId === me.activeTenantId);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
            {tenant?.tenantName ?? 'Sem tenant selecionado'}
          </p>
          <h1 className="text-2xl font-semibold text-white">Olá, {me.user.name.split(' ')[0]}</h1>
          <p className="text-sm text-slate-400">
            {tenant ? `Seu papel: ${tenant.role}` : 'Peça acesso ao administrador do seu tenant.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/perfil"
            className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5"
          >
            Perfil
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5"
            >
              Sair
            </button>
          </form>
        </div>
      </header>

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
          Seus acessos
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {me.permissions.map((permission) => (
            <li
              key={permission}
              className="rounded-full bg-white/5 px-3 py-1 font-mono text-xs text-slate-300"
            >
              {permission}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-400">
          Os dashboards do doc 15 entram na Fase 7. Até lá, o produto está construindo a base:
          identidade, isolamento por tenant e integração com o ERP.
        </p>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
            Prontidão da API
          </h2>
          <StateBadge state={state} />
        </div>
        {checks.length > 0 ? (
          <ul className="mt-4">
            {checks.map((check) => (
              <DependencyRow key={check.name} check={check} />
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-400">A API não respondeu ao verificar o estado.</p>
        )}
      </section>

      <footer className="text-xs text-slate-500">
        versão {readiness.data?.version ?? env.appVersion}
      </footer>
    </main>
  );
}
