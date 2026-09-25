'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest, ERP_TIMEOUT_MS, errorMessage } from '@/lib/server/api-client';
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
    // Os três campos abaixo existem porque a SG ainda não respondeu Q2/Q4/Q5 (doc 34): em vez de
    // a suposição ficar cravada no código, ela fica aqui, ajustável por tenant.
    apiPathPrefix: String(formData.get('apiPathPrefix') ?? '').trim(),
    ...(String(formData.get('authHeaderMode') ?? '')
      ? { authHeaderMode: String(formData.get('authHeaderMode')) as 'raw' | 'bearer' }
      : {}),
    ...(String(formData.get('pageSize') ?? '').trim()
      ? { pageSize: Number(formData.get('pageSize')) }
      : {}),
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
    // O teste autentica e consulta o status no ERP dentro do request; com o timeout padrão de
    // 10 s o Next desistia antes da API terminar e acusava falha num teste que deu certo.
  }>('POST', '/tenant/erp-connection/test', undefined, { timeoutMs: ERP_TIMEOUT_MS });

  revalidatePath('/admin/conexao-erp');

  if (!response.ok) {
    return { error: errorMessage(response, 'O teste não conseguiu falar com o ERP.') };
  }

  const dados = response.data;
  const mudanca =
    (dados?.rotasAdicionadas.length ?? 0) + (dados?.rotasRemovidas.length ?? 0) > 0
      ? ` Contrato mudou: +${dados?.rotasAdicionadas.length} / −${dados?.rotasRemovidas.length} rotas.`
      : '';

  // Lista vazia não é "zero rotas contratadas": a autorização da SG pode responder sem o campo
  // `routes` (o corpo e a claim do token são opcionais na prática), e nesse caso o produto não
  // sabe o contrato — em vez de restringir, ele deixa passar. Dizer "0 rotas" afirmava um fato
  // que o teste não mediu, e assustava sem motivo.
  const rotas = dados?.routesGranted.length ?? 0;
  const contrato =
    rotas > 0
      ? `${rotas} rotas contratadas.`
      : 'A instalação não informou a lista de rotas do contrato — nenhum painel será restringido por ela.';

  return {
    success:
      `Conexão OK com ${dados?.health?.razaoSocial ?? 'o ERP'}` +
      `${dados?.health?.versao ? ` (versão ${dados.health.versao})` : ''}. ` +
      `${contrato}${mudanca}`,
  };
}
