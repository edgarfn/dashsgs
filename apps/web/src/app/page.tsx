import type { DependencyHealth } from '@dashsgs/shared';
import { fetchReadiness } from '@/lib/server/api';
import { getWebEnv } from '@/lib/server/env';

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
 * Página do esqueleto (Fase 2): prova, de ponta a ponta, que web → API → Postgres/Redis está
 * de pé. A Fase 7 substitui este conteúdo pela home executiva (doc 15 §1).
 */
export default async function HomePage() {
  const env = getWebEnv();
  const readiness = await fetchReadiness();
  const state = readiness.data?.state ?? 'down';
  const checks = readiness.data?.checks ?? [];

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
          Fase 2 — Foundation (doc 29)
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-white">{env.appName}</h1>
        <p className="max-w-xl text-sm leading-relaxed text-slate-400">
          Plataforma multi-tenant sobre a API SG Sistemas. Este esqueleto valida configuração, logs
          correlacionados, tratamento de erro e as dependências de infraestrutura antes de qualquer
          dado de negócio existir.
        </p>
      </header>

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6 shadow-lg shadow-black/20">
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
          <p className="mt-4 text-sm text-slate-400">
            A API não respondeu. Suba a infraestrutura com{' '}
            <code className="rounded bg-white/5 px-1.5 py-0.5 text-slate-300">pnpm infra:up</code> e
            a aplicação com{' '}
            <code className="rounded bg-white/5 px-1.5 py-0.5 text-slate-300">pnpm dev</code>.
          </p>
        )}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          versão {readiness.data?.version ?? env.appVersion}
          {readiness.data ? ` · no ar há ${readiness.data.uptimeSeconds}s` : ''}
        </span>
        {readiness.correlationId ? <span>correlação {readiness.correlationId}</span> : null}
      </footer>
    </main>
  );
}
