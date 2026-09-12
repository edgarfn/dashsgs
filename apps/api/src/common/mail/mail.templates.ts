import { type MailMessage } from './mail.service';

/**
 * Modelos de e-mail transacional.
 *
 * Regras: texto puro sempre presente (cliente de e-mail corporativo costuma bloquear HTML),
 * HTML sem imagem externa (rastreamento e bloqueio), link completo visível no corpo — quem
 * recebe precisa poder conferir o domínio antes de clicar.
 */

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
    <p style="margin:0 0 24px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#64748b">DashSGS</p>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px">
    <p style="margin:0;font-size:12px;color:#64748b">
      Se você não esperava esta mensagem, ignore-a — nenhuma ação será tomada.
    </p>
  </div>
</body></html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0">
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(label)}</a>
  </p>
  <p style="margin:0;font-size:13px;color:#475569;word-break:break-all">${escapeHtml(url)}</p>`;
}

export function inviteEmail(params: {
  to: string;
  tenantName: string;
  invitedByName: string;
  url: string;
  expiresInHours: number;
}): MailMessage {
  const { to, tenantName, invitedByName, url, expiresInHours } = params;
  return {
    to,
    subject: `Convite para o DashSGS — ${tenantName}`,
    text: [
      `${invitedByName} convidou você para acessar o DashSGS da ${tenantName}.`,
      '',
      `Para aceitar, abra o link abaixo (expira em ${expiresInHours} horas e serve uma única vez):`,
      url,
      '',
      'Se você não esperava este convite, ignore esta mensagem.',
    ].join('\n'),
    html: layout(
      'Convite para o DashSGS',
      `<h1 style="margin:0 0 12px;font-size:20px">Você foi convidado para a ${escapeHtml(tenantName)}</h1>
       <p style="margin:0;font-size:15px;line-height:1.6;color:#334155">
         ${escapeHtml(invitedByName)} convidou você para acessar o DashSGS.
         O link vale uma única vez e expira em ${expiresInHours} horas.
       </p>
       ${button(url, 'Aceitar convite')}`,
    ),
  };
}

export function passwordResetEmail(params: {
  to: string;
  url: string;
  expiresInMinutes: number;
}): MailMessage {
  const { to, url, expiresInMinutes } = params;
  return {
    to,
    subject: 'Redefinição de senha — DashSGS',
    text: [
      'Recebemos um pedido para redefinir a senha da sua conta no DashSGS.',
      '',
      `Use o link abaixo (expira em ${expiresInMinutes} minutos e serve uma única vez):`,
      url,
      '',
      'Se não foi você, ignore esta mensagem: a senha atual continua valendo.',
    ].join('\n'),
    html: layout(
      'Redefinição de senha',
      `<h1 style="margin:0 0 12px;font-size:20px">Redefinir sua senha</h1>
       <p style="margin:0;font-size:15px;line-height:1.6;color:#334155">
         O link vale uma única vez e expira em ${expiresInMinutes} minutos.
         Ao concluir, todas as sessões abertas serão encerradas.
       </p>
       ${button(url, 'Definir nova senha')}`,
    ),
  };
}

/** Aviso de segurança: mudanças sensíveis avisam o dono da conta, mesmo quando foi ele. */
export function securityNoticeEmail(params: {
  to: string;
  event: 'password_changed' | 'mfa_enabled' | 'mfa_disabled';
  when: Date;
  ip?: string | null;
}): MailMessage {
  const titles: Record<typeof params.event, string> = {
    password_changed: 'Sua senha foi alterada',
    mfa_enabled: 'Verificação em duas etapas ativada',
    mfa_disabled: 'Verificação em duas etapas desativada',
  };
  const title = titles[params.event];
  const quando = params.when.toISOString();
  const origem = params.ip ? ` (origem: ${params.ip})` : '';

  return {
    to: params.to,
    subject: `${title} — DashSGS`,
    text: [
      `${title} em ${quando}${origem}.`,
      '',
      'Se não foi você, redefina a senha imediatamente e fale com o administrador do seu tenant.',
    ].join('\n'),
    html: layout(
      title,
      `<h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h1>
       <p style="margin:0;font-size:15px;line-height:1.6;color:#334155">
         Registrado em ${escapeHtml(quando)}${escapeHtml(origem)}.
       </p>
       <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#b91c1c">
         Se não foi você, redefina a senha imediatamente e avise o administrador do seu tenant.
       </p>`,
    ),
  };
}
