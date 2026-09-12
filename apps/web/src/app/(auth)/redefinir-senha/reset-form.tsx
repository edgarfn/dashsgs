'use client';

import { useActionState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { resetPasswordAction, type FormState } from '../actions';

export function ResetForm({ token, minLength }: { token: string; minLength: number }) {
  const [state, action] = useActionState<FormState, FormData>(resetPasswordAction, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      <input type="hidden" name="token" value={token} />

      <Field
        label="Nova senha"
        name="password"
        type="password"
        autoComplete="new-password"
        hint={`Pelo menos ${minLength} caracteres. Prefira uma frase longa a símbolos aleatórios.`}
        autoFocus
      />
      <Field
        label="Confirme a nova senha"
        name="passwordConfirmation"
        type="password"
        autoComplete="new-password"
      />

      <SubmitButton>Salvar nova senha</SubmitButton>
    </form>
  );
}
