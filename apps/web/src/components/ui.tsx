'use client';

import { useId } from 'react';
import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Primitivos de UI do fluxo de autenticação.
 *
 * Acessibilidade não é enfeite aqui (doc 16 §5): todo campo tem label associado, erro é anunciado
 * por `role="alert"` e o foco é visível. O design system completo entra na Fase 7.
 */

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  required = true,
  defaultValue,
  hint,
  inputMode,
  maxLength,
  autoFocus,
  readOnly,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
  inputMode?: 'text' | 'numeric';
  maxLength?: number;
  autoFocus?: boolean;
  readOnly?: boolean;
}) {
  // Id único por instância: a mesma "Filiais" aparece uma vez por membro na tela de acessos,
  // e ids repetidos fariam todos os rótulos apontarem para o primeiro campo — leitor de tela
  // e teste automatizado encontrariam a linha errada.
  const id = `${useId()}-${name}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-app-fg">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        readOnly={readOnly}
        aria-describedby={hint ? `${id}-ajuda` : undefined}
        className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2.5 text-app-fg outline-none transition placeholder:text-app-muted read-only:text-app-muted focus:border-app-accent/60 focus:ring-2 focus:ring-app-accent/30"
      />
      {hint ? (
        <p id={`${id}-ajuda`} className="text-xs text-app-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  children,
  variant = 'primary',
}: {
  children: ReactNode;
  variant?: 'primary' | 'danger' | 'ghost';
}) {
  const { pending } = useFormStatus();
  const styles = {
    primary: 'bg-app-accent text-app-accent-fg hover:opacity-90',
    danger: 'bg-app-danger/90 text-white hover:bg-app-danger',
    ghost: 'border border-app-border text-app-fg hover:bg-app-hover',
  }[variant];

  return (
    <button
      type="submit"
      disabled={pending}
      className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${styles}`}
    >
      {pending ? 'Aguarde…' : children}
    </button>
  );
}

export function Alert({
  kind,
  children,
}: {
  kind: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-app-danger/30 bg-app-danger/10 text-app-danger',
    success: 'border-app-success/30 bg-app-success/10 text-app-success',
    info: 'border-app-accent/30 bg-app-accent/10 text-app-accent',
  }[kind];

  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3 py-2.5 text-sm ${styles}`}
    >
      {children}
    </p>
  );
}
