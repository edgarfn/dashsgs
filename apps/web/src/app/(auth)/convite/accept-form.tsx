'use client';

import { useActionState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { acceptInviteAction, type FormState } from '../actions';

export function AcceptInviteForm({
  token,
  email,
  existingUser,
  minLength,
}: {
  token: string;
  email: string;
  existingUser: boolean;
  minLength: number;
}) {
  const [state, action] = useActionState<FormState, FormData>(acceptInviteAction, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      <input type="hidden" name="token" value={token} />

      <Field label="E-mail" name="email" defaultValue={email} readOnly required={false} />
      <Field label="Seu nome" name="name" autoComplete="name" autoFocus />

      {existingUser ? (
        <Alert kind="info">
          Você já tem conta no DashSGS. Continue usando a sua senha atual — este convite só adiciona
          o novo acesso.
        </Alert>
      ) : (
        <>
          <Field
            label="Crie uma senha"
            name="password"
            type="password"
            autoComplete="new-password"
            hint={`Pelo menos ${minLength} caracteres. Prefira uma frase longa.`}
          />
          <Field
            label="Confirme a senha"
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
          />
        </>
      )}

      <SubmitButton>Aceitar convite</SubmitButton>
    </form>
  );
}
