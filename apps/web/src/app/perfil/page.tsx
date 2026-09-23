import Link from 'next/link';
import { cookies } from 'next/headers';
import { PASSWORD_MIN_LENGTH } from '@dashsgs/shared';
import { describeDevice, listSessions, requireMe } from '@/lib/server/session';
import { THEME_COOKIE, type Theme } from '@/lib/theme';
import { ThemeToggle } from '@/components/theme-toggle';
import { ChangePasswordForm, DisableMfaForm, RevokeSessionButton } from './forms';

export const metadata = { title: 'Perfil — DashSGS' };

const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Autosserviço da conta: senha, verificação em duas etapas, aparência e dispositivos conectados. */
export default async function ProfilePage() {
  const me = await requireMe();
  const sessions = await listSessions();
  const cookieTheme = (await cookies()).get(THEME_COOKIE)?.value;
  const temaAtual: Theme | null =
    cookieTheme === 'light' || cookieTheme === 'dark' ? cookieTheme : null;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-xs uppercase tracking-[0.2em] text-app-muted hover:text-app-fg"
        >
          DashSGS
        </Link>
        <h1 className="text-2xl font-semibold text-app-fg">Perfil</h1>
        <p className="text-sm text-app-muted">
          {me.user.name} · {me.user.email}
        </p>
      </header>

      <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">Senha</h2>
        <ChangePasswordForm minLength={PASSWORD_MIN_LENGTH} />
      </section>

      <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">
            Verificação em duas etapas
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
              me.mfa.enabled
                ? 'bg-app-success/10 text-app-success ring-app-success/30'
                : 'bg-app-warning/10 text-app-warning ring-app-warning/30'
            }`}
          >
            {me.mfa.enabled ? 'ativa' : 'inativa'}
          </span>
        </div>

        {me.mfa.enabled ? (
          me.mfa.required ? (
            <p className="text-sm text-app-muted">
              Seu papel exige segundo fator, então ele não pode ser desativado. Perdeu o
              dispositivo? Use um código de recuperação para entrar e cadastre outro aplicativo.
            </p>
          ) : (
            <DisableMfaForm />
          )
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-app-muted">
              Proteja a conta com um aplicativo autenticador. Leva menos de um minuto.
            </p>
            <Link
              href="/mfa/cadastrar"
              className="inline-block rounded-lg bg-app-accent px-4 py-2 text-sm font-semibold text-app-accent-fg transition hover:opacity-90"
            >
              Ativar verificação
            </Link>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">Aparência</h2>
        <p className="text-sm text-app-muted">
          Escolha o tema da interface. Sem escolha salva, o DashSGS segue o tema do seu sistema
          operacional.
        </p>
        <ThemeToggle temaAtual={temaAtual} />
      </section>

      <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-app-muted">
          Dispositivos conectados
        </h2>

        <ul className="divide-y divide-app-border">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="space-y-0.5">
                <p className="text-sm text-app-fg">
                  {describeDevice(session.userAgent)}
                  {session.current ? (
                    <span className="ml-2 rounded bg-app-accent/10 px-1.5 py-0.5 text-xs text-app-accent">
                      esta sessão
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-app-muted">
                  {session.ip ?? 'IP desconhecido'} · ativo em{' '}
                  {dataHora.format(new Date(session.lastSeenAt))} · expira em{' '}
                  {dataHora.format(new Date(session.expiresAt))}
                </p>
              </div>
              <RevokeSessionButton sessionId={session.id} current={session.current} />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
