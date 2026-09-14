'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest, errorMessage } from '@/lib/server/api-client';
import { type FormState } from '../../(auth)/actions';

/** Antecipa a rodada diária de retenção (E6-04). O que ela apaga já deveria ter sido apagado. */
export async function executarRetencaoAction(): Promise<FormState> {
  const response = await apiRequest<{
    purga: { removidos: number };
    offboarding: unknown[];
    pendenciasApos: Array<{ politica: string; pendentes: number }>;
  }>('POST', '/platform/retencao/executar');

  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível executar a retenção.') };
  }

  revalidatePath('/plataforma/retencao');

  const restantes = (response.data?.pendenciasApos ?? []).filter((linha) => linha.pendentes > 0);
  const removidos = response.data?.purga.removidos ?? 0;
  const tenants = response.data?.offboarding.length ?? 0;

  // Sobrar linha depois da purga é o sinal de que alguma política não está sendo cumprida — e a
  // tela precisa dizer isso, não comemorar o número de linhas apagadas.
  if (restantes.length > 0) {
    return {
      error: `Purga concluída (${removidos} linha(s)), mas ${restantes.length} política(s) continuam com dado fora do prazo: ${restantes
        .map((linha) => linha.politica)
        .join(', ')}.`,
    };
  }

  return {
    success: `Purga concluída: ${removidos} linha(s) removida(s)${
      tenants > 0 ? ` e ${tenants} contrato(s) purgado(s)` : ''
    }. Nada fora da retenção.`,
  };
}
