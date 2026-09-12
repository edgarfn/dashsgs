'use client';

import { useActionState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { loginAction, type FormState } from '../actions';

export function LoginForm() {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}

      <Field label="E-mail" name="email" type="email" autoComplete="username" autoFocus />
      <Field label="Senha" name="password" type="password" autoComplete="current-password" />

      <SubmitButton>Entrar</SubmitButton>
    </form>
  );
}
