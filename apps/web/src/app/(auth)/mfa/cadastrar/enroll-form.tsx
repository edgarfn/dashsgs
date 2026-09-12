'use client';

import { useActionState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { enableTotpAction, type FormState } from '../../actions';

export function EnrollForm() {
  const [state, action] = useActionState<FormState, FormData>(enableTotpAction, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}

      <Field
        label="Código do aplicativo"
        name="totp"
        inputMode="numeric"
        maxLength={6}
        autoComplete="one-time-code"
        autoFocus
      />

      <SubmitButton>Ativar verificação</SubmitButton>
    </form>
  );
}
