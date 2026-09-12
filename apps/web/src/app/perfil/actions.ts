'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiRequest, errorMessage, relaySetCookies } from '@/lib/server/api-client';
import { type FormState } from '../(auth)/actions';

/** Ações do autosserviço da conta (doc 16 §2 "Perfil"). */

export async function changePasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirmation = String(formData.get('newPasswordConfirmation') ?? '');

  if (newPassword !== confirmation) return { error: 'As senhas não conferem.' };

  const response = await apiRequest('POST', '/auth/password/change', {
    currentPassword,
    newPassword,
  });

  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível trocar a senha.') };
  }

  revalidatePath('/perfil');
  return { success: 'Senha alterada. As outras sessões foram encerradas.' };
}

export async function disableMfaAction(_state: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get('password') ?? '');
  const totp = String(formData.get('totp') ?? '').trim();

  const response = await apiRequest('POST', '/auth/mfa/disable', { password, totp });
  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível desativar a verificação.') };
  }

  revalidatePath('/perfil');
  return { success: 'Verificação em duas etapas desativada.' };
}

export async function revokeSessionAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const sessionId = String(formData.get('sessionId') ?? '');
  const current = String(formData.get('current') ?? '') === '1';

  const response = await apiRequest('DELETE', `/auth/sessions/${encodeURIComponent(sessionId)}`);
  await relaySetCookies(response.setCookies);

  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível encerrar a sessão.') };
  }

  // Encerrar a própria sessão é logout: não adianta revalidar uma página que não existe mais.
  if (current) redirect('/entrar');

  revalidatePath('/perfil');
  return { success: 'Sessão encerrada.' };
}
