'use server';

import { type Role } from '@dashsgs/shared';
import { revalidatePath } from 'next/cache';
import { apiRequest, errorMessage } from '@/lib/server/api-client';
import { type FormState } from '../../(auth)/actions';

/** Ações da tela Admin → Usuários (doc 16 §2), todas sob a permissão `users.manage`. */

const parseFiliais = (raw: string): number[] | undefined => {
  const limpo = raw.trim();
  if (limpo === '') return [];
  const ids = limpo.split(',').map((parte) => Number(parte.trim()));
  return ids.some((id) => !Number.isInteger(id) || id <= 0) ? undefined : ids;
};

export async function inviteMemberAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim();
  const role = String(formData.get('role') ?? '') as Role;
  const filiais = parseFiliais(String(formData.get('filiaisAllowed') ?? ''));

  if (filiais === undefined) {
    return {
      error: 'Filiais: use ids numéricos separados por vírgula (ou deixe vazio para todas).',
    };
  }

  const response = await apiRequest('POST', '/tenant/invites', {
    email,
    role,
    filiaisAllowed: filiais,
  });

  if (!response.ok) return { error: errorMessage(response, 'Não foi possível convidar.') };

  revalidatePath('/admin/usuarios');
  return { success: `Convite enviado para ${email}.` };
}

export async function revokeInviteAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get('inviteId') ?? '');
  const response = await apiRequest('DELETE', `/tenant/invites/${encodeURIComponent(id)}`);

  if (!response.ok) return { error: errorMessage(response, 'Não foi possível revogar o convite.') };

  revalidatePath('/admin/usuarios');
  return { success: 'Convite revogado.' };
}

export async function updateMemberAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const membershipId = String(formData.get('membershipId') ?? '');
  const role = String(formData.get('role') ?? '') as Role;
  const filiais = parseFiliais(String(formData.get('filiaisAllowed') ?? ''));

  if (filiais === undefined) {
    return {
      error: 'Filiais: use ids numéricos separados por vírgula (ou deixe vazio para todas).',
    };
  }

  const response = await apiRequest('PATCH', `/tenant/users/${encodeURIComponent(membershipId)}`, {
    role,
    filiaisAllowed: filiais,
  });

  if (!response.ok) return { error: errorMessage(response, 'Não foi possível salvar.') };

  revalidatePath('/admin/usuarios');
  return { success: 'Acesso atualizado.' };
}

export async function removeMemberAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const membershipId = String(formData.get('membershipId') ?? '');
  const response = await apiRequest('DELETE', `/tenant/users/${encodeURIComponent(membershipId)}`);

  if (!response.ok) return { error: errorMessage(response, 'Não foi possível remover o acesso.') };

  revalidatePath('/admin/usuarios');
  return { success: 'Acesso removido.' };
}
