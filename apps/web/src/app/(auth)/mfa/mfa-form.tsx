'use client';

import { useActionState, useState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { verifyMfaAction, type FormState } from '../actions';

export function MfaForm() {
  const [state, action] = useActionState<FormState, FormData>(verifyMfaAction, {});
  const [usarRecuperacao, setUsarRecuperacao] = useState(false);

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}

      {usarRecuperacao ? (
        <Field
          label="Código de recuperação"
          name="recoveryCode"
          autoComplete="one-time-code"
          hint="Um dos códigos que você guardou ao ativar a verificação. Cada um serve uma vez."
          autoFocus
        />
      ) : (
        <Field
          label="Código do aplicativo"
          name="totp"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          autoFocus
        />
      )}

      <SubmitButton>Verificar</SubmitButton>

      <button
        type="button"
        onClick={() => setUsarRecuperacao((atual) => !atual)}
        className="w-full text-center text-sm text-app-accent underline-offset-4 hover:underline"
      >
        {usarRecuperacao ? 'Usar o código do aplicativo' : 'Perdi o acesso ao aplicativo'}
      </button>
    </form>
  );
}
