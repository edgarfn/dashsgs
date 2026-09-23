import Link from 'next/link';
import { Alert } from '@/components/ui';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';
import { CreateTenantForm, OffboardForm, ResumeButton, SuspendForm } from './forms';

export const metadata = { title: 'Plataforma — DashSGS' };
export const dynamic = 'force-dynamic';

/** Espelha `VerificacaoDaCadeia` da API (platform/auditoria.controller.ts). */
interface VerificacaoDaCadeia {
  ok: boolean;
  conferidas: number;
  quebradaEm: string | null;
  total: number;
  verificadoEm: string;
}

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
  const [tenants, cadeia] = await Promise.all([
    apiRequest<TenantResumo[]>('GET', '/platform/tenants'),
    apiRequest<VerificacaoDaCadeia>('GET', '/platform/auditoria/verificacao'),
  ]);

  // A API responde 404 para quem não opera a plataforma: a tela repete a mesma resposta.
  if (!me.user.platformAdmin || tenants.status === 404) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-app-fg">Página não encontrada</h1>
        <Link href="/" className="text-sm text-app-accent underline-offset-4 hover:underline">
          Voltar para a home
        </Link>
      </main>
    );
  }

  if (tenants.status === 401) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-app-fg">Verificação necessária</h1>
        <Alert kind="info">
          Esta área exige verificação em duas etapas recente. Entre novamente para continuar.
        </Alert>
        <Link href="/perfil" className="text-sm text-app-accent underline-offset-4 hover:underline">
          Ir para o perfil
        </Link>
      </main>
    );
  }

  const lista = tenants.data ?? [];
  const integridade = cadeia.data;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-xs uppercase tracking-[0.2em] text-app-muted hover:text-app-fg"
        >
          DashSGS · operação
        </Link>
        <h1 className="text-2xl font-semibold text-app-fg">Tenants</h1>
        <p className="text-sm text-app-muted">
          {lista.length} contrato(s). Criar, suspender, reativar e desligar — tudo auditado com ator
          e motivo.
        </p>
        <nav className="flex flex-wrap gap-3 pt-2 text-sm">
          <Link
            href="/plataforma/retencao"
            className="text-app-accent underline-offset-4 hover:underline"
          >
            Retenção e descarte
          </Link>
          <Link
            href="/plataforma/break-glass"
            className="text-app-accent underline-offset-4 hover:underline"
          >
            Break-glass
          </Link>
        </nav>
      </header>

      {/*
        A verificação é da instalação inteira, não de um tenant: a cadeia encadeia por `id`, sem
        separar por cliente. É por isso que ela mora aqui e não na tela de auditoria do tenant —
        verificar "só a parte de A" não significaria nada, porque o elo que falta pode ser de B.
      */}
      <section className="space-y-2 rounded-xl border border-app-border bg-app-surface p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">
          Integridade da trilha de auditoria
        </h2>
        {!integridade ? (
          <p className="text-sm text-app-muted">Não foi possível verificar a cadeia agora.</p>
        ) : integridade.ok ? (
          <>
            <p className="text-sm text-app-success">
              ✓ Cadeia íntegra — {integridade.conferidas.toLocaleString('pt-BR')} entradas
              reconferidas de {integridade.total.toLocaleString('pt-BR')}.
            </p>
            <p className="text-xs text-app-muted">
              Cada entrada é reconstruída e comparada com o hash gravado. A verificação percorre a
              cauda da trilha: cinco anos a cada carregamento de página tornaria o número inútil.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-app-danger">
              ✗ Cadeia quebrada na entrada {integridade.quebradaEm} —{' '}
              {integridade.conferidas.toLocaleString('pt-BR')} entradas conferidas.
            </p>
            <p className="text-xs text-app-muted">
              Isto é incidente de segurança, não defeito de tela: a aplicação não tem privilégio
              para alterar a trilha. Siga o doc 27 antes de qualquer outra coisa.
            </p>
          </>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">Contratos</h2>

        <ul className="divide-y divide-app-border">
          {lista.map((tenant) => (
            <li key={tenant.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium text-app-fg">
                    {tenant.name}{' '}
                    <span className="font-mono text-xs text-app-muted">({tenant.slug})</span>
                  </p>
                  <p className="text-xs text-app-muted">
                    plano {tenant.plan} · {tenant.membros} membro(s) · {tenant.convitesPendentes}{' '}
                    convite(s) pendente(s) · desde {data.format(new Date(tenant.createdAt))}
                  </p>
                  {tenant.suspensionReason ? (
                    <p className="mt-1 text-xs text-app-warning">
                      Suspenso em{' '}
                      {tenant.suspendedAt ? data.format(new Date(tenant.suspendedAt)) : '—'}:{' '}
                      {tenant.suspensionReason}
                    </p>
                  ) : null}
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                    tenant.status === 'active'
                      ? 'bg-app-success/10 text-app-success ring-app-success/30'
                      : 'bg-app-warning/10 text-app-warning ring-app-warning/30'
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

      <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">
          Provisionar tenant
        </h2>
        <CreateTenantForm />
      </section>
    </main>
  );
}
