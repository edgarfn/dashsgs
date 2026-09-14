import Link from 'next/link';
import { Alert } from '@/components/ui';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';
import { CreateTenantForm, OffboardForm, ResumeButton, SuspendForm } from './forms';

export const metadata = { title: 'Plataforma — DashSGS' };
export const dynamic = 'force-dynamic';

interface TenantResumo {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  membros: number;
  convitesPendentes: number;
  createdAt: string;
  suspendedAt: string | null;
  suspensionReason: string | null;
}

const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

/**
 * Painel da plataforma (E3-07). Torna executáveis os runbooks 22 §1 e §2 sem `psql` na produção.
 *
 * Este painel administra **contratos**, não dados de tenant: não há aqui nenhuma janela para
 * vendas, estoque ou financeiro de cliente. Isso é break-glass, com ticket (runbook 22 §11).
 */
export default async function PlataformaPage() {
  const me = await requireMe();
  const tenants = await apiRequest<TenantResumo[]>('GET', '/platform/tenants');

  // A API responde 404 para quem não opera a plataforma: a tela repete a mesma resposta.
  if (!me.user.platformAdmin || tenants.status === 404) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-white">Página não encontrada</h1>
        <Link href="/" className="text-sm text-sky-300 underline-offset-4 hover:underline">
          Voltar para a home
        </Link>
      </main>
    );
  }

  if (tenants.status === 401) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-white">Verificação necessária</h1>
        <Alert kind="info">
          Esta área exige verificação em duas etapas recente. Entre novamente para continuar.
        </Alert>
        <Link href="/perfil" className="text-sm text-sky-300 underline-offset-4 hover:underline">
          Ir para o perfil
        </Link>
      </main>
    );
  }

  const lista = tenants.data ?? [];

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-xs uppercase tracking-[0.2em] text-slate-500 hover:text-slate-300"
        >
          DashSGS · operação
        </Link>
        <h1 className="text-2xl font-semibold text-white">Tenants</h1>
        <p className="text-sm text-slate-400">
          {lista.length} contrato(s). Criar, suspender, reativar e desligar — tudo auditado com ator
          e motivo.
        </p>
        <nav className="flex flex-wrap gap-3 pt-2 text-sm">
          <Link
            href="/plataforma/retencao"
            className="text-sky-300 underline-offset-4 hover:underline"
          >
            Retenção e descarte
          </Link>
          <Link
            href="/plataforma/break-glass"
            className="text-sky-300 underline-offset-4 hover:underline"
          >
            Break-glass
          </Link>
        </nav>
      </header>

      <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Contratos</h2>

        <ul className="divide-y divide-white/5">
          {lista.map((tenant) => (
            <li key={tenant.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-200">
                    {tenant.name}{' '}
                    <span className="font-mono text-xs text-slate-500">({tenant.slug})</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    plano {tenant.plan} · {tenant.membros} membro(s) · {tenant.convitesPendentes}{' '}
                    convite(s) pendente(s) · desde {data.format(new Date(tenant.createdAt))}
                  </p>
                  {tenant.suspensionReason ? (
                    <p className="mt-1 text-xs text-amber-300">
                      Suspenso em{' '}
                      {tenant.suspendedAt ? data.format(new Date(tenant.suspendedAt)) : '—'}:{' '}
                      {tenant.suspensionReason}
                    </p>
                  ) : null}
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                    tenant.status === 'active'
                      ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
                  }`}
                >
                  {tenant.status === 'active' ? 'ativo' : 'suspenso'}
                </span>
              </div>

              {tenant.status === 'active' ? (
                <SuspendForm tenantId={tenant.id} />
              ) : (
                <ResumeButton tenantId={tenant.id} />
              )}

              <OffboardForm tenantId={tenant.id} slug={tenant.slug} />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
          Provisionar tenant
        </h2>
        <CreateTenantForm />
      </section>
    </main>
  );
}
