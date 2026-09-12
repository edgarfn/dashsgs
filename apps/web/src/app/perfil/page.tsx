import Link from 'next/link';
import { PASSWORD_MIN_LENGTH } from '@dashsgs/shared';
import { describeDevice, listSessions, requireMe } from '@/lib/server/session';
import { ChangePasswordForm, DisableMfaForm, RevokeSessionButton } from './forms';

export const metadata = { title: 'Perfil — DashSGS' };

const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Autosserviço da conta: senha, verificação em duas etapas e dispositivos conectados. */
export default async function ProfilePage() {
  const me = await requireMe();
  const sessions = await listSessions();

  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-xs uppercase tracking-[0.2em] text-slate-500 hover:text-slate-300"
        >
          DashSGS
        </Link>
        <h1 className="text-2xl font-semibold text-white">Perfil</h1>
        <p className="text-sm text-slate-400">
          {me.user.name} · {me.user.email}
        </p>
      </header>

      <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Senha</h2>
        <ChangePasswordForm minLength={PASSWORD_MIN_LENGTH} />
      </section>

      <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
            Verificação em duas etapas
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
              me.mfa.enabled
                ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                : 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
            }`}
          >
            {me.mfa.enabled ? 'ativa' : 'inativa'}
          </span>
        </div>

        {me.mfa.enabled ? (
          me.mfa.required ? (
            <p className="text-sm text-slate-400">
              Seu papel exige segundo fator, então ele não pode ser desativado. Perdeu o
              dispositivo? Use um código de recuperação para entrar e cadastre outro aplicativo.
            </p>
          ) : (
            <DisableMfaForm />
          )
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              Proteja a conta com um aplicativo autenticador. Leva menos de um minuto.
            </p>
            <Link
              href="/mfa/cadastrar"
              className="inline-block rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
            >
              Ativar verificação
            </Link>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
          Dispositivos conectados
        </h2>

        <ul className="divide-y divide-white/5">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="space-y-0.5">
                <p className="text-sm text-slate-200">
                  {describeDevice(session.userAgent)}
                  {session.current ? (
                    <span className="ml-2 rounded bg-sky-500/10 px-1.5 py-0.5 text-xs text-sky-300">
                      esta sessão
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-slate-500">
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
