'use client';

import { ROLES, type Role } from '@dashsgs/shared';
import { useActionState } from 'react';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { type FormState } from '../../(auth)/actions';
import {
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
  updateMemberAction,
} from './actions';

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner — tudo, inclusive cobrança',
  admin: 'Admin — usuários, ERP e módulos',
  manager: 'Gerente — dashboards, alertas e propostas',
  analyst: 'Analista — dashboards e exportações',
  viewer: 'Visualizador — só consulta',
  auditor: 'Auditor — consulta e trilha de auditoria',
};

function RoleSelect({ name, defaultValue }: { name: string; defaultValue?: Role }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`campo-${name}`} className="block text-sm font-medium text-slate-200">
        Papel
      </label>
      <select
        id={`campo-${name}`}
        name={name}
        defaultValue={defaultValue ?? 'viewer'}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-slate-100 outline-none focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/30"
      >
        {ROLES.map((role) => (
          <option key={role} value={role} className="bg-slate-900">
            {ROLE_LABEL[role]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function InviteForm() {
  const [state, action] = useActionState<FormState, FormData>(inviteMemberAction, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      <Field label="E-mail" name="email" type="email" autoComplete="off" />
      <RoleSelect name="role" />
      <Field
        label="Filiais permitidas"
        name="filiaisAllowed"
        required={false}
        hint="Ids separados por vírgula (ex.: 1,2). Vazio = todas as filiais do tenant."
      />

      <SubmitButton>Enviar convite</SubmitButton>
    </form>
  );
}

export function MemberRow({
  membershipId,
  role,
  filiaisAllowed,
  podeEditar,
}: {
  membershipId: string;
  role: Role;
  filiaisAllowed: number[];
  podeEditar: boolean;
}) {
  const [updateState, update] = useActionState<FormState, FormData>(updateMemberAction, {});
  const [removeState, remove] = useActionState<FormState, FormData>(removeMemberAction, {});

  if (!podeEditar) {
    return <p className="text-xs text-slate-500">Você não edita o próprio vínculo.</p>;
  }

  return (
    <div className="space-y-2">
      {updateState.error ? <Alert kind="error">{updateState.error}</Alert> : null}
      {removeState.error ? <Alert kind="error">{removeState.error}</Alert> : null}

      <form action={update} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="membershipId" value={membershipId} />
        <div className="w-56">
          <RoleSelect name="role" defaultValue={role} />
        </div>
        <div className="w-44">
          <Field
            label="Filiais"
            name="filiaisAllowed"
            required={false}
            defaultValue={filiaisAllowed.join(',')}
          />
        </div>
        <button
          type="submit"
          className="rounded-lg border border-white/15 px-3 py-2.5 text-sm text-slate-200 transition hover:bg-white/5"
        >
          Salvar
        </button>
      </form>

      <form action={remove}>
        <input type="hidden" name="membershipId" value={membershipId} />
        <button type="submit" className="text-xs text-rose-300 underline-offset-4 hover:underline">
          Remover acesso
        </button>
      </form>
    </div>
  );
}

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const [state, action] = useActionState<FormState, FormData>(revokeInviteAction, {});

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="inviteId" value={inviteId} />
      {state.error ? <span className="text-xs text-rose-300">{state.error}</span> : null}
      <button
        type="submit"
        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200 transition hover:border-rose-400/40 hover:text-rose-200"
      >
        Revogar
      </button>
    </form>
  );
}
