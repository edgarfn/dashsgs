/**
 * Catálogo da trilha de auditoria (doc 05 §6 / doc 16 §2 "Admin — Auditoria" / E6-01).
 *
 * Existe porque a tela mostra **eventos para pessoas**, não códigos para máquinas. Um auditor
 * lendo `auth.mfa.disable_denied` numa coluna não sabe se aquilo é um problema; lendo "Tentativa
 * de desativar o MFA recusada", sabe na hora.
 *
 * O catálogo também é o filtro: agrupar por categoria é o que permite responder "o que mudou de
 * acesso este mês?" sem conhecer o vocabulário interno do produto.
 *
 * `apps/api/test/unit/auditoria-catalogo.spec.ts` compara esta lista com todas as ações que o
 * código realmente grava. Ação nova sem entrada aqui apareceria na tela como um código cru — e
 * ninguém descobriria até um auditor perguntar o que significa.
 */

export const AUDIT_CATEGORIAS = [
  'acesso',
  'conta',
  'membros',
  'integracao',
  'dados',
  'plataforma',
] as const;
export type AuditCategoria = (typeof AUDIT_CATEGORIAS)[number];

export const AUDIT_CATEGORIA_LABEL: Record<AuditCategoria, string> = {
  acesso: 'Acesso',
  conta: 'Conta e senha',
  membros: 'Pessoas e papéis',
  integracao: 'Conexão com o ERP',
  dados: 'Dados e sincronização',
  plataforma: 'Plataforma',
};

export interface AuditAcaoInfo {
  label: string;
  categoria: AuditCategoria;
  /**
   * `true` quando o evento merece atenção mesmo sem ninguém estar procurando: negativa de acesso,
   * segundo fator desligado, acesso excepcional. A tela destaca; o resto é histórico normal.
   */
  sensivel?: boolean;
}

export const AUDIT_ACOES: Record<string, AuditAcaoInfo> = {
  // --- acesso
  'auth.login.succeeded': { label: 'Entrou no sistema', categoria: 'acesso' },
  'auth.login.failed': {
    label: 'Tentativa de login recusada',
    categoria: 'acesso',
    sensivel: true,
  },
  'auth.login.mfa_required': { label: 'Login aguardando segundo fator', categoria: 'acesso' },
  'auth.login.mfa_enrollment_required': {
    label: 'Login aguardando cadastro do segundo fator',
    categoria: 'acesso',
  },
  'auth.logout': { label: 'Saiu do sistema', categoria: 'acesso' },
  'auth.session.revoked': { label: 'Sessão encerrada', categoria: 'acesso' },
  'auth.mfa.succeeded': { label: 'Segundo fator confirmado', categoria: 'acesso' },
  'auth.mfa.failed': { label: 'Segundo fator recusado', categoria: 'acesso', sensivel: true },
  'authz.denied': { label: 'Acesso negado pela permissão', categoria: 'acesso', sensivel: true },

  // --- conta
  'auth.mfa.enabled': { label: 'Segundo fator ativado', categoria: 'conta' },
  'auth.mfa.disabled': { label: 'Segundo fator desativado', categoria: 'conta', sensivel: true },
  'auth.mfa.disable_denied': {
    label: 'Tentativa de desativar o segundo fator recusada',
    categoria: 'conta',
    sensivel: true,
  },
  'auth.password.changed': { label: 'Senha alterada', categoria: 'conta' },
  'auth.password.change_denied': {
    label: 'Troca de senha recusada',
    categoria: 'conta',
    sensivel: true,
  },
  'auth.password.reset_requested': { label: 'Recuperação de senha solicitada', categoria: 'conta' },
  'auth.password.reset': { label: 'Senha redefinida por recuperação', categoria: 'conta' },

  // --- membros
  'user.invited': { label: 'Convite enviado', categoria: 'membros' },
  'user.invite_accepted': { label: 'Convite aceito', categoria: 'membros' },
  'user.invite_revoked': { label: 'Convite cancelado', categoria: 'membros' },
  'tenant.member_updated': { label: 'Papel ou filiais alterados', categoria: 'membros' },
  'tenant.member_removed': { label: 'Pessoa removida da rede', categoria: 'membros' },

  // --- integração
  'erp_connection.created': { label: 'Conexão com o ERP cadastrada', categoria: 'integracao' },
  'erp_connection.updated': { label: 'Conexão com o ERP alterada', categoria: 'integracao' },
  'erp_connection.tested': { label: 'Conexão com o ERP testada', categoria: 'integracao' },
  'erp_connection.routes_changed': {
    label: 'Rotas contratadas na SG mudaram',
    categoria: 'integracao',
    sensivel: true,
  },

  // --- dados
  'sync.resync_requested': { label: 'Re-sincronização pedida', categoria: 'dados' },
  'sync.backfill_started': { label: 'Carga histórica iniciada', categoria: 'dados' },
  'sync.backfill_cancelled': { label: 'Carga histórica cancelada', categoria: 'dados' },
  'alert.acknowledged': { label: 'Alerta reconhecido', categoria: 'dados' },
  // Levar a trilha para fora é o momento em que ela sai do nosso controle (doc 10 §3) — por isso
  // o próprio export vira evento, e um evento que a tela destaca.
  'audit.exported': { label: 'Trilha de auditoria exportada', categoria: 'dados', sensivel: true },
  'retencao.purge': { label: 'Purga de retenção executada', categoria: 'dados' },

  // --- plataforma
  'platform.tenant_created': { label: 'Rede provisionada', categoria: 'plataforma' },
  'platform.tenant_suspended': {
    label: 'Rede suspensa',
    categoria: 'plataforma',
    sensivel: true,
  },
  'platform.tenant_resumed': { label: 'Rede reativada', categoria: 'plataforma' },
  'platform.tenant_offboarded': {
    label: 'Rede desligada (exclusão agendada)',
    categoria: 'plataforma',
    sensivel: true,
  },
  'tenant.purged': { label: 'Dados da rede apagados em definitivo', categoria: 'plataforma' },
  'breakglass.requested': {
    label: 'Acesso excepcional solicitado',
    categoria: 'plataforma',
    sensivel: true,
  },
  'breakglass.approved': {
    label: 'Acesso excepcional aprovado',
    categoria: 'plataforma',
    sensivel: true,
  },
  'breakglass.access': {
    label: 'Acesso excepcional usado',
    categoria: 'plataforma',
    sensivel: true,
  },
  'breakglass.revoked': { label: 'Acesso excepcional revogado', categoria: 'plataforma' },
};

export const AUDIT_RESULTADOS = ['success', 'denied', 'error'] as const;
export type AuditResultado = (typeof AUDIT_RESULTADOS)[number];

export const AUDIT_RESULTADO_LABEL: Record<AuditResultado, string> = {
  success: 'concluído',
  denied: 'negado',
  error: 'erro',
};

/** Rótulo de uma ação; ação desconhecida devolve o próprio código, nunca vazio. */
export function rotuloDaAcao(acao: string): string {
  return AUDIT_ACOES[acao]?.label ?? acao;
}

export function categoriaDaAcao(acao: string): AuditCategoria | null {
  return AUDIT_ACOES[acao]?.categoria ?? null;
}

export function acaoSensivel(acao: string): boolean {
  return AUDIT_ACOES[acao]?.sensivel ?? false;
}

/** Uma linha da trilha como a tela a consome (doc 23 §Tenancy). */
export interface AuditEntryView {
  id: string;
  createdAt: string;
  acao: string;
  /** Rótulo em português, já resolvido no servidor — a tela não precisa do catálogo inteiro. */
  acaoLabel: string;
  categoria: AuditCategoria | null;
  sensivel: boolean;
  resultado: AuditResultado;
  recursoTipo: string;
  recursoId: string | null;
  /** Quem fez. `null` quando o ator não foi identificado (login de e-mail inexistente). */
  ator: { userId: string; nome: string; email: string } | null;
  ip: string | null;
  /** Mudanças relevantes, já sem segredo nem PII bruta (doc 18 §1). */
  changes: Record<string, unknown> | null;
}
