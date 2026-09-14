'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest, errorMessage } from '@/lib/server/api-client';
import { type FormState } from '../(auth)/actions';

/** Ações do feed e das regras de alerta (doc 16 §2). */

export async function reconhecerAction(_state: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');

  const response = await apiRequest('POST', `/alertas/${id}/reconhecer`);
  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível reconhecer o alerta.') };
  }

  revalidatePath('/alertas');
  return { success: 'Alerta reconhecido.' };
}

export async function alternarRegraAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const ligar = formData.get('ligar') === 'true';

  const response = await apiRequest('PATCH', `/alertas/regras/${id}`, { enabled: ligar });
  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível alterar a regra.') };
  }

  revalidatePath('/alertas/regras');
  return { success: ligar ? 'Aviso ligado.' : 'Aviso desligado.' };
}

export async function ajustarRegraAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const canalEmail = formData.get('canalEmail') === 'on';

  // Os limiares chegam como `param.<nome>`: cada tipo de regra tem os seus (doc 15 §8).
  const params: Record<string, number> = {};
  for (const [chave, valor] of formData.entries()) {
    if (!chave.startsWith('param.')) continue;
    const numero = Number(valor);
    if (Number.isFinite(numero)) params[chave.slice('param.'.length)] = numero;
  }

  const response = await apiRequest('PATCH', `/alertas/regras/${id}`, {
    canalEmail,
    ...(Object.keys(params).length > 0 ? { params } : {}),
  });

  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível salvar os ajustes.') };
  }

  revalidatePath('/alertas/regras');
  return { success: 'Ajustes salvos. Eles valem a partir da próxima avaliação.' };
}

export async function avaliarAgoraAction(): Promise<FormState> {
  const response = await apiRequest<{ eventosNovos: number; ocorrencias: number }>(
    'POST',
    '/alertas/avaliar',
  );

  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível avaliar as regras agora.') };
  }

  revalidatePath('/alertas');
  revalidatePath('/alertas/regras');

  const novos = response.data?.eventosNovos ?? 0;
  return {
    success:
      novos > 0
        ? `Avaliação concluída: ${novos} ${novos === 1 ? 'alerta novo' : 'alertas novos'}.`
        : 'Avaliação concluída: nada novo para avisar.',
  };
}
