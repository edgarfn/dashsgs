'use client';

import { useActionState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { type FormState } from '../../(auth)/actions';
import {
  aprovarBreakGlassAction,
  revogarBreakGlassAction,
  solicitarBreakGlassAction,
} from './actions';

/** O formulário é deliberadamente detalhado: cada campo aqui vira linha de auditoria. */
export function SolicitarForm({ tenants }: { tenants: Array<{ id: string; slug: string }> }) {
  const [state, action] = useActionState<FormState, FormData>(solicitarBreakGlassAction, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      <div className="space-y-1.5">
        <label htmlFor="campo-tenant" className="block text-sm font-medium text-app-fg">
          Tenant
        </label>
        <select
          id="campo-tenant"
          name="tenantId"
          className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-fg"
        >
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.slug}
            </option>
          ))}
        </select>
      </div>

      <Field label="Chamado" name="ticket" autoComplete="off" hint="Ex.: SUP-4521." />
      <Field
        label="Justificativa"
        name="justificativa"
        autoComplete="off"
        maxLength={300}
        hint="O cliente vai ler este texto no e-mail de aviso. Diga o que precisa ser visto e por quê."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="campo-papel" className="block text-sm font-medium text-app-fg">
            Papel concedido
          </label>
          <select
            id="campo-papel"
            name="papel"
            defaultValue="viewer"
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-fg"
          >
            <option value="viewer">viewer — só enxerga o dashboard</option>
            <option value="analyst">analyst — dashboard e exportação</option>
            <option value="manager">manager — inclui financeiro</option>
          </select>
          <p className="text-xs text-app-muted">
            Peça o menor papel que resolve. Owner e admin não são concedidos por break-glass.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="campo-minutos" className="block text-sm font-medium text-app-fg">
            Duração
          </label>
          <select
            id="campo-minutos"
            name="minutos"
            defaultValue="120"
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-fg"
          >
            <option value="30">30 minutos</option>
            <option value="60">1 hora</option>
            <option value="120">2 horas (padrão do runbook)</option>
            <option value="240">4 horas</option>
            <option value="480">8 horas (máximo)</option>
          </select>
          <p className="text-xs text-app-muted">O prazo começa a contar na aprovação.</p>
        </div>
      </div>

      <SubmitButton>Abrir pedido de acesso</SubmitButton>
    </form>
  );
}

export function AprovarForm({ id }: { id: string }) {
  const [state, action] = useActionState<FormState, FormData>(aprovarBreakGlassAction, {});

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {state.error ? (
        <span className="w-full text-xs text-app-danger" role="alert">
          {state.error}
        </span>
      ) : null}
      <button
        type="submit"
        className="rounded-lg border border-app-warning/30 px-3 py-2 text-sm text-app-warning transition hover:bg-app-warning/10"
      >
        Aprovar (sou outra pessoa)
      </button>
    </form>
  );
}

export function RevogarForm({ id }: { id: string }) {
  const [state, action] = useActionState<FormState, FormData>(revogarBreakGlassAction, {});

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {state.error ? (
        <span className="w-full text-xs text-app-danger" role="alert">
          {state.error}
        </span>
      ) : null}
      <button
        type="submit"
        className="rounded-lg border border-app-border px-3 py-2 text-sm text-app-fg transition hover:border-app-danger/40 hover:text-app-danger"
      >
        Revogar agora
      </button>
    </form>
  );
}
