import 'server-only';
import { type MeResponse, type SessionSummary } from '@dashsgs/shared';
import { redirect } from 'next/navigation';
import { apiRequest } from './api-client';

/**
 * Leitura da sessão no servidor.
 *
 * O front nunca decide autorização — ele pergunta ao backend quem é o usuário e quais permissões
 * ele tem, e usa isso apenas para desenhar a tela (doc 07 §1).
 */

export async function getMe(): Promise<MeResponse | null> {
  const response = await apiRequest<MeResponse>('GET', '/me');
  return response.ok ? response.data : null;
}

/** Perfil de uma sessão que ainda não concluiu o MFA (telas de desafio e cadastro). */
export async function getPendingMe(): Promise<MeResponse | null> {
  const response = await apiRequest<MeResponse>('GET', '/me/pending');
  return response.ok ? response.data : null;
}

/** Exige sessão completa; manda para o login (ou para o MFA) quando não houver. */
export async function requireMe(): Promise<MeResponse> {
  const me = await getMe();
  if (me) return me;

  const pending = await getPendingMe();
  if (pending) redirect(pending.mfa.enabled ? '/mfa' : '/mfa/cadastrar');
  redirect('/entrar');
}

export async function listSessions(): Promise<SessionSummary[]> {
  const response = await apiRequest<SessionSummary[]>('GET', '/auth/sessions');
  return response.data ?? [];
}

/** Descrição curta do dispositivo a partir do user-agent — só para a pessoa se reconhecer. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Dispositivo desconhecido';

  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Safari\//.test(userAgent)
        ? 'Safari'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : 'Navegador';

  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'sistema desconhecido';

  return `${browser} · ${os}`;
}
