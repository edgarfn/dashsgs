'use server';

import {
  type InvitePreview,
  type LoginResponse,
  type TotpEnableResponse,
  type TotpSetupResponse,
} from '@dashsgs/shared';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiRequest, errorMessage, relaySetCookies } from '@/lib/server/api-client';

/**
 * Server Actions da autenticação.
 *
 * Rodam no servidor do Next (BFF): recebem o formulário, chamam a API interna e repassam ao
 * navegador os cookies emitidos. O Next valida a origem dos Server Actions, o cookie de sessão é
 * SameSite=Lax e a API ainda exige o token anti-CSRF — três camadas para a mesma classe de ataque.
 */

export interface FormState {
  error?: string;
  /** Preenchido quando a ação termina com sucesso mas a tela continua na mesma rota. */
  success?: string;
}

const readString = (formData: FormData, field: string): string =>
  String(formData.get(field) ?? '').trim();

export async function loginAction(_state: FormState, formData: FormData): Promise<FormState> {
  const email = readString(formData, 'email');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Informe e-mail e senha.' };
  }

  const response = await apiRequest<LoginResponse>(
    'POST',
    '/auth/login',
    { email, password },
    { authenticated: false },
  );
  await relaySetCookies(response.setCookies);

  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível entrar.') };
  }

  const destino =
    response.data?.status === 'mfa_required'
      ? '/mfa'
      : response.data?.status === 'mfa_enrollment_required'
        ? '/mfa/cadastrar'
        : '/';

  redirect(destino);
}

export async function verifyMfaAction(_state: FormState, formData: FormData): Promise<FormState> {
  const totp = readString(formData, 'totp');
  const recoveryCode = readString(formData, 'recoveryCode');

  if (!totp && !recoveryCode) {
    return { error: 'Informe o código do aplicativo ou um código de recuperação.' };
  }

  const response = await apiRequest<void>(
    'POST',
    '/auth/mfa/verify',
    totp ? { totp } : { recoveryCode },
  );
  await relaySetCookies(response.setCookies);

  if (!response.ok) {
    return { error: errorMessage(response, 'Código inválido.') };
  }

  redirect('/');
}

export async function startTotpSetupAction(): Promise<TotpSetupResponse | { error: string }> {
  const response = await apiRequest<TotpSetupResponse>('POST', '/auth/mfa/setup');
  if (!response.ok || !response.data) {
    return { error: errorMessage(response, 'Não foi possível iniciar o cadastro.') };
  }
  return response.data;
}

export async function enableTotpAction(_state: FormState, formData: FormData): Promise<FormState> {
  const totp = readString(formData, 'totp');
  const response = await apiRequest<TotpEnableResponse>('POST', '/auth/mfa/enable', { totp });
  await relaySetCookies(response.setCookies);

  if (!response.ok || !response.data) {
    return { error: errorMessage(response, 'Código inválido. Tente o próximo código do app.') };
  }

  // Os códigos de recuperação só existem em claro aqui: vão para a tela numa etapa dedicada.
  const codes = encodeURIComponent(response.data.recoveryCodes.join(','));
  redirect(`/mfa/codigos?codes=${codes}`);
}

export async function forgotPasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = readString(formData, 'email');
  if (!email) return { error: 'Informe o e-mail da conta.' };

  await apiRequest('POST', '/auth/password/forgot', { email }, { authenticated: false });

  // Resposta idêntica exista ou não a conta (doc 06 §3): a tela não confirma cadastro.
  return {
    success:
      'Se houver uma conta com esse e-mail, o link de redefinição chega em instantes. Confira também o spam.',
  };
}

export async function resetPasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = readString(formData, 'token');
  const password = String(formData.get('password') ?? '');
  const confirmation = String(formData.get('passwordConfirmation') ?? '');

  if (password !== confirmation) return { error: 'As senhas não conferem.' };

  const response = await apiRequest(
    'POST',
    '/auth/password/reset',
    { token, password },
    { authenticated: false },
  );
  await relaySetCookies(response.setCookies);

  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível redefinir a senha.') };
  }

  redirect('/entrar?redefinida=1');
}

export async function acceptInviteAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = readString(formData, 'token');
  const name = readString(formData, 'name');
  const password = String(formData.get('password') ?? '');
  const confirmation = String(formData.get('passwordConfirmation') ?? '');

  if (password !== confirmation) return { error: 'As senhas não conferem.' };

  const response = await apiRequest<{ email: string }>(
    'POST',
    '/invites/accept',
    { token, name, ...(password ? { password } : {}) },
    { authenticated: false },
  );

  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível aceitar o convite.') };
  }

  redirect('/entrar?convite=aceito');
}

export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const response = await apiRequest<InvitePreview>(
    'GET',
    `/invites/preview?token=${encodeURIComponent(token)}`,
    undefined,
    { authenticated: false },
  );
  return response.ok ? response.data : null;
}

export async function logoutAction(): Promise<void> {
  const response = await apiRequest('POST', '/auth/logout');
  await relaySetCookies(response.setCookies);
  revalidatePath('/', 'layout');
  redirect('/entrar');
}
