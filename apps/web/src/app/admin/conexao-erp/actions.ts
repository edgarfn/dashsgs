'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest, errorMessage } from '@/lib/server/api-client';
import { type FormState } from '../../(auth)/actions';

/** Ações do wizard de conexão com o ERP (doc 16 §2 "Admin — Conexão ERP"). */

export async function salvarConexaoAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const senha = String(formData.get('senha') ?? '');

  const payload = {
    baseUrl: String(formData.get('baseUrl') ?? '').trim(),
    username: String(formData.get('username') ?? '').trim(),
    // Campo em branco significa "mantenha a senha que já está no cofre" — ela nunca é exibida.
    ...(senha ? { senha } : {}),
    isSgCloud: formData.get('isSgCloud') === 'on',
    tlsMode: (String(formData.get('tlsMode') ?? 'https') === 'vpn' ? 'vpn' : 'https') as
      'https' | 'vpn',
    maxRps: Number(formData.get('maxRps') ?? 4),
  };

  const response = await apiRequest('PUT', '/tenant/erp-connection', payload);

  if (!response.ok) {
    return { error: errorMessage(response, 'Não foi possível salvar a conexão.') };
  }

  revalidatePath('/admin/conexao-erp');
  return { success: 'Conexão salva. Rode o teste para confirmar que ela está de pé.' };
}

export async function testarConexaoAction(): Promise<FormState> {
  const response = await apiRequest<{
    status: string;
    routesGranted: string[];
    rotasAdicionadas: string[];
    rotasRemovidas: string[];
    health: { versao: string | null; razaoSocial: string | null } | null;
  }>('POST', '/tenant/erp-connection/test');

  revalidatePath('/admin/conexao-erp');

  if (!response.ok) {
    return { error: errorMessage(response, 'O teste não conseguiu falar com o ERP.') };
  }

  const dados = response.data;
  const mudanca =
    (dados?.rotasAdicionadas.length ?? 0) + (dados?.rotasRemovidas.length ?? 0) > 0
      ? ` Contrato mudou: +${dados?.rotasAdicionadas.length} / −${dados?.rotasRemovidas.length} rotas.`
      : '';

  return {
    success:
      `Conexão OK com ${dados?.health?.razaoSocial ?? 'o ERP'}` +
      `${dados?.health?.versao ? ` (versão ${dados.health.versao})` : ''}. ` +
      `${dados?.routesGranted.length ?? 0} rotas contratadas.${mudanca}`,
  };
}
