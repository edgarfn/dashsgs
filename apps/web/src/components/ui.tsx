'use client';

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
  const id = `campo-${name}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-200">
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
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-slate-100 outline-none transition placeholder:text-slate-500 read-only:text-slate-400 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/30"
      />
      {hint ? (
        <p id={`${id}-ajuda`} className="text-xs text-slate-400">
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
    primary: 'bg-sky-500 text-slate-950 hover:bg-sky-400',
    danger: 'bg-rose-500/90 text-white hover:bg-rose-500',
    ghost: 'border border-white/15 text-slate-200 hover:bg-white/5',
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
    error: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    info: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
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
