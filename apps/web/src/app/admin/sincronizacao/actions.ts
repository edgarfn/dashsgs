'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest, errorMessage } from '@/lib/server/api-client';
import { type FormState } from '../../(auth)/actions';

/** Ações do painel de sincronização (doc 26 §Status / E5-12). */

export async function ressincronizarAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const domain = String(formData.get('domain') ?? '');
  const filial = String(formData.get('filialErpId') ?? '');
  const data = String(formData.get('data') ?? '').trim();

  const response = await apiRequest('POST', '/tenant/sync/resync', {
    domain,
    ...(filial && filial !== '0' ? { filialErpId: Number(filial) } : {}),
    ...(data ? { data } : {}),
  });

  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível pedir a ressincronização.') };
  }

  revalidatePath('/admin/sincronizacao');
  return {
    success:
      'Ressincronização na fila. Ela roda em segundo plano — atualize a página em alguns minutos.',
  };
}

export async function iniciarBackfillAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const dias = Number(formData.get('dias') ?? 90);

  const response = await apiRequest('POST', '/tenant/sync/backfill', { dias });

  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível iniciar a carga histórica.') };
  }

  revalidatePath('/admin/sincronizacao');
  return {
    success: `Carga de ${dias} dias iniciada. Ela avança do dia mais recente para trás, sem atrapalhar a sincronização do dia a dia.`,
  };
}

export async function cancelarBackfillAction(): Promise<FormState> {
  const response = await apiRequest('DELETE', '/tenant/sync/backfill');

  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível cancelar a carga.') };
  }

  revalidatePath('/admin/sincronizacao');
  return { success: 'Carga histórica interrompida. O que já entrou continua no lugar.' };
}
