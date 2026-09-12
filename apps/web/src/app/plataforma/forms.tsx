'use client';

import { useActionState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { type FormState } from '../(auth)/actions';
import { createTenantAction, resumeTenantAction, suspendTenantAction } from './actions';

export function CreateTenantForm() {
  const [state, action] = useActionState<FormState, FormData>(createTenantAction, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      <Field label="Nome da rede" name="name" autoComplete="off" />
      <Field
        label="Slug"
        name="slug"
        autoComplete="off"
        hint="Minúsculas, números e hífen. Entra em URLs e em chaves de cache."
      />
      <Field label="Plano" name="plan" defaultValue="beta" autoComplete="off" />
      <Field
        label="E-mail do owner"
        name="ownerEmail"
        type="email"
        autoComplete="off"
        hint="Recebe o convite para assumir o tenant (expira em 72 h)."
      />

      <SubmitButton>Criar tenant e convidar owner</SubmitButton>
    </form>
  );
}

export function SuspendForm({ tenantId }: { tenantId: string }) {
  const [state, action] = useActionState<FormState, FormData>(suspendTenantAction, {});

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      {state.error ? (
        <span className="w-full text-xs text-rose-300" role="alert">
          {state.error}
        </span>
      ) : null}
      <div className="w-64">
        <Field label="Motivo" name="reason" required={false} />
      </div>
      <button
        type="submit"
        className="rounded-lg border border-white/15 px-3 py-2.5 text-sm text-slate-200 transition hover:border-rose-400/40 hover:text-rose-200"
      >
        Suspender
      </button>
    </form>
  );
}

export function ResumeButton({ tenantId }: { tenantId: string }) {
  const [state, action] = useActionState<FormState, FormData>(resumeTenantAction, {});

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      {state.error ? (
        <span className="text-xs text-rose-300" role="alert">
          {state.error}
        </span>
      ) : null}
      <button
        type="submit"
        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/40 hover:text-emerald-200"
      >
        Reativar
      </button>
    </form>
  );
}
