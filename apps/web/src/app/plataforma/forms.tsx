'use client';

import { useActionState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { type FormState } from '../(auth)/actions';
import {
  createTenantAction,
  offboardTenantAction,
  resumeTenantAction,
  suspendTenantAction,
} from './actions';

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

/** Desligamento: exclusão lógica hoje, purga física em 30 dias (doc 08 §5). */
export function OffboardForm({ tenantId, slug }: { tenantId: string; slug: string }) {
  const [state, action] = useActionState<FormState, FormData>(offboardTenantAction, {});

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-app-muted hover:text-app-danger">
        Desligar contrato
      </summary>
      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tenantId" value={tenantId} />
        {state.error ? (
          <span className="w-full text-xs text-app-danger" role="alert">
            {state.error}
          </span>
        ) : null}
        {state.success ? (
          <span className="w-full text-xs text-app-success" role="status">
            {state.success}
          </span>
        ) : null}
        <div className="w-64">
          <Field label="Motivo do desligamento" name="reason" required={false} />
        </div>
        <div className="w-48">
          <Field
            label="Confirme o slug"
            name="confirmarSlug"
            required={false}
            hint={`Digite "${slug}".`}
          />
        </div>
        <button
          type="submit"
          className="rounded-lg border border-app-danger/30 px-3 py-2.5 text-sm text-app-danger transition hover:bg-app-danger/10"
        >
          Desligar
        </button>
      </form>
    </details>
  );
}

export function SuspendForm({ tenantId }: { tenantId: string }) {
  const [state, action] = useActionState<FormState, FormData>(suspendTenantAction, {});

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      {state.error ? (
        <span className="w-full text-xs text-app-danger" role="alert">
          {state.error}
        </span>
      ) : null}
      <div className="w-64">
        <Field label="Motivo" name="reason" required={false} />
      </div>
      <button
        type="submit"
        className="rounded-lg border border-app-border px-3 py-2.5 text-sm text-app-fg transition hover:border-app-danger/40 hover:text-app-danger"
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
        <span className="text-xs text-app-danger" role="alert">
          {state.error}
        </span>
      ) : null}
      <button
        type="submit"
        className="rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-fg transition hover:border-app-success/40 hover:text-app-success"
      >
        Reativar
      </button>
    </form>
  );
}
