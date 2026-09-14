'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest, errorMessage } from '@/lib/server/api-client';
import { type FormState } from '../../(auth)/actions';

/** Break-glass (runbook 22 §11): pedir, aprovar (outra pessoa) e revogar. */

export async function solicitarBreakGlassAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const payload = {
    tenantId: String(formData.get('tenantId') ?? ''),
    ticket: String(formData.get('ticket') ?? '').trim(),
    justificativa: String(formData.get('justificativa') ?? '').trim(),
    papel: String(formData.get('papel') ?? 'viewer'),
    minutos: Number(formData.get('minutos') ?? 120),
  };

  if (payload.justificativa.length < 20) {
    // A justificativa vai para a auditoria e para o e-mail do cliente: "suporte" não explica nada.
    return { error: 'Escreva a justificativa com pelo menos 20 caracteres.' };
  }

  const response = await apiRequest('POST', '/platform/break-glass', payload);
  if (!response.ok) return { error: errorMessage(response, 'Não foi possível abrir o pedido.') };

  revalidatePath('/plataforma/break-glass');
  return {
    success:
      'Pedido registrado. Ele não abre nada até que outra pessoa da equipe aprove — e o owner do tenant será avisado na aprovação.',
  };
}

export async function aprovarBreakGlassAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const response = await apiRequest(
    'POST',
    `/platform/break-glass/${encodeURIComponent(id)}/aprovar`,
  );

  if (!response.ok) return { error: errorMessage(response, 'Não foi possível aprovar.') };

  revalidatePath('/plataforma/break-glass');
  return { success: 'Acesso liberado e owner notificado. Expira sozinho no prazo do pedido.' };
}

export async function revogarBreakGlassAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const response = await apiRequest(
    'POST',
    `/platform/break-glass/${encodeURIComponent(id)}/revogar`,
  );

  if (!response.ok) return { error: errorMessage(response, 'Não foi possível revogar.') };

  revalidatePath('/plataforma/break-glass');
  return { success: 'Concessão encerrada.' };
}
