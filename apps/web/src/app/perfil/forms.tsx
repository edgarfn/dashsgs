'use client';

import { useActionState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { type FormState } from '../(auth)/actions';
import { changePasswordAction, disableMfaAction, revokeSessionAction } from './actions';

export function ChangePasswordForm({ minLength }: { minLength: number }) {
  const [state, action] = useActionState<FormState, FormData>(changePasswordAction, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      <Field
        label="Senha atual"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
      />
      <Field
        label="Nova senha"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        hint={`Pelo menos ${minLength} caracteres. As demais sessões serão encerradas.`}
      />
      <Field
        label="Confirme a nova senha"
        name="newPasswordConfirmation"
        type="password"
        autoComplete="new-password"
      />

      <SubmitButton>Trocar senha</SubmitButton>
    </form>
  );
}

export function DisableMfaForm() {
  const [state, action] = useActionState<FormState, FormData>(disableMfaAction, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      <p className="text-sm text-slate-400">
        Para desativar, confirme com a senha e um código do aplicativo — sessão roubada não basta.
      </p>

      <Field label="Senha" name="password" type="password" autoComplete="current-password" />
      <Field
        label="Código do aplicativo"
        name="totp"
        inputMode="numeric"
        maxLength={6}
        autoComplete="one-time-code"
      />

      <SubmitButton variant="danger">Desativar verificação</SubmitButton>
    </form>
  );
}

export function RevokeSessionButton({
  sessionId,
  current,
}: {
  sessionId: string;
  current: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(revokeSessionAction, {});

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="current" value={current ? '1' : '0'} />
      {state.error ? <span className="text-xs text-rose-300">{state.error}</span> : null}
      <button
        type="submit"
        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-rose-400/40 hover:text-rose-200"
      >
        {current ? 'Sair deste dispositivo' : 'Encerrar'}
      </button>
    </form>
  );
}
