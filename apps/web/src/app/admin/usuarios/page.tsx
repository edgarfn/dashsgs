import { type Role } from '@dashsgs/shared';
import Link from 'next/link';
import { Alert } from '@/components/ui';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';
import { InviteForm, MemberRow, RevokeInviteButton } from './forms';

export const metadata = { title: 'Usuários — DashSGS' };
export const dynamic = 'force-dynamic';

interface Membro {
  membershipId: string;
  role: Role;
  filiaisAllowed: number[];
  memberSince: string;
  user: {
    id: string;
    name: string;
    email: string;
    status: string;
    mfaEnabled: boolean;
    lastLoginAt: string | null;
  };
}

interface ConvitePendente {
  id: string;
  email: string;
  role: Role;
  filiaisAllowed: number[];
  expiresAt: string;
}

const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

/**
 * Admin → Usuários (doc 16 §2).
 *
 * A tela só desenha o que o backend já autorizou: sem `users.manage`, ela nem carrega. Esconder
 * botão não é autorização — a autorização está no guard, aqui é só não mostrar o que seria negado.
 */
export default async function UsuariosPage() {
  const me = await requireMe();

  // 403 amigável, sem revelar o que existiria do outro lado (doc 16 §3).
  if (!me.permissions.includes('users.manage')) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-app-fg">Sem acesso a esta área</h1>
        <Alert kind="info">
          A gestão de usuários é restrita a quem administra o tenant. Fale com o owner da sua rede
          se precisar deste acesso.
        </Alert>
        <Link href="/" className="text-sm text-app-accent underline-offset-4 hover:underline">
          Voltar para a home
        </Link>
      </main>
    );
  }

  const [membros, convites] = await Promise.all([
    apiRequest<Membro[]>('GET', '/tenant/users'),
    apiRequest<ConvitePendente[]>('GET', '/tenant/invites'),
  ]);

  const tenant = me.memberships.find((item) => item.tenantId === me.activeTenantId);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-xs uppercase tracking-[0.2em] text-app-muted hover:text-app-fg"
        >
          {tenant?.tenantName ?? 'DashSGS'}
        </Link>
        <h1 className="text-2xl font-semibold text-app-fg">Usuários e acessos</h1>
        <p className="text-sm text-app-muted">
          Quem entra, com que papel e em quais filiais. Toda alteração fica na trilha de auditoria.
        </p>
      </header>

      <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">
          Membros ({membros.data?.length ?? 0})
        </h2>

        <ul className="divide-y divide-app-border">
          {(membros.data ?? []).map((membro) => (
            <li key={membro.membershipId} className="space-y-3 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium text-app-fg">
                    {membro.user.name}
                    {membro.user.id === me.user.id ? (
                      <span className="ml-2 rounded bg-app-accent/10 px-1.5 py-0.5 text-xs text-app-accent">
                        você
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-app-muted">
                    {membro.user.email} · {membro.user.mfaEnabled ? 'MFA ativo' : 'sem MFA'} ·{' '}
                    {membro.user.lastLoginAt
                      ? `último acesso ${data.format(new Date(membro.user.lastLoginAt))}`
                      : 'nunca acessou'}
                  </p>
                </div>
                <span className="rounded-full bg-app-surface px-3 py-1 font-mono text-xs text-app-fg">
                  {membro.role}
                </span>
              </div>

              <MemberRow
                membershipId={membro.membershipId}
                role={membro.role}
                filiaisAllowed={membro.filiaisAllowed}
                podeEditar={membro.user.id !== me.user.id}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">
          Convites pendentes
        </h2>

        {convites.data && convites.data.length > 0 ? (
          <ul className="divide-y divide-app-border">
            {convites.data.map((convite) => (
              <li
                key={convite.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm text-app-fg">{convite.email}</p>
                  <p className="text-xs text-app-muted">
                    papel {convite.role} · expira em {data.format(new Date(convite.expiresAt))}
                  </p>
                </div>
                <RevokeInviteButton inviteId={convite.id} />
              </li>
            ))}
          </ul>
        ) : (
          <Alert kind="info">Nenhum convite pendente.</Alert>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">
          Convidar alguém
        </h2>
        <InviteForm />
      </section>
    </main>
  );
}
