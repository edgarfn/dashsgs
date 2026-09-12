'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest, errorMessage } from '@/lib/server/api-client';
import { type FormState } from '../(auth)/actions';

/** Ações do painel da plataforma — runbooks 22 §1 (provisionar) e §2 (suspender/reativar). */

export async function createTenantAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const payload = {
    name: String(formData.get('name') ?? '').trim(),
    slug: String(formData.get('slug') ?? '')
      .trim()
      .toLowerCase(),
    plan: String(formData.get('plan') ?? 'beta').trim(),
    ownerEmail: String(formData.get('ownerEmail') ?? '').trim(),
  };

  const response = await apiRequest<{ slug: string }>('POST', '/platform/tenants', payload);
  if (!response.ok) return { error: errorMessage(response, 'Não foi possível criar o tenant.') };

  revalidatePath('/plataforma');
  return {
    success: `Tenant ${payload.slug} criado. O convite de owner foi enviado para ${payload.ownerEmail}.`,
  };
}

export async function suspendTenantAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenantId = String(formData.get('tenantId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();

  if (reason.length < 5) {
    // O motivo vai para a auditoria: suspensão sem justificativa não se explica depois.
    return { error: 'Descreva o motivo da suspensão (mínimo 5 caracteres).' };
  }

  const response = await apiRequest(
    'POST',
    `/platform/tenants/${encodeURIComponent(tenantId)}/suspend`,
    { reason },
  );
  if (!response.ok) return { error: errorMessage(response, 'Não foi possível suspender.') };

  revalidatePath('/plataforma');
  return { success: 'Tenant suspenso. Sessões encerradas e logins bloqueados.' };
}

export async function resumeTenantAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenantId = String(formData.get('tenantId') ?? '');

  const response = await apiRequest(
    'POST',
    `/platform/tenants/${encodeURIComponent(tenantId)}/resume`,
  );
  if (!response.ok) return { error: errorMessage(response, 'Não foi possível reativar.') };

  revalidatePath('/plataforma');
  return { success: 'Tenant reativado.' };
}
