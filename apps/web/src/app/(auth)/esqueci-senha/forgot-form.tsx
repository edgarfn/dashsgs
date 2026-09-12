'use client';

import { useActionState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { forgotPasswordAction, type FormState } from '../actions';

export function ForgotForm() {
  const [state, action] = useActionState<FormState, FormData>(forgotPasswordAction, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      <Field label="E-mail" name="email" type="email" autoComplete="username" autoFocus />
      <SubmitButton>Enviar link</SubmitButton>
    </form>
  );
}
