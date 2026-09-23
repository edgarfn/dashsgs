'use client';

import Script from 'next/script';
import { useActionState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { loginAction, type FormState } from '../actions';

interface LoginFormProps {
  /** Site key do widget Cloudflare Turnstile — pública por design (doc 06). */
  siteKey: string;
  /** Mesmo nonce da CSP desta requisição (doc 09 §1); sem ele o script é bloqueado. */
  nonce?: string;
}

export function LoginForm({ siteKey, nonce }: LoginFormProps) {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}

      <Field label="E-mail" name="email" type="email" autoComplete="username" autoFocus />
      <Field label="Senha" name="password" type="password" autoComplete="current-password" />

      {/* O script, ao carregar, desenha o widget aqui e injeta um <input type="hidden"
          name="cf-turnstile-response"> dentro da div — o form nativo já o inclui no submit,
          sem JS extra da nossa parte. */}
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="dark" />
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        nonce={nonce}
        async
        defer
      />

      <SubmitButton>Entrar</SubmitButton>
    </form>
  );
}
