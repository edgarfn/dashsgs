import { type Role } from './tenancy';

/**
 * Catálogo de permissões (doc 07 §3), no formato `recurso.ação`.
 *
 * É uma tabela estática versionada em código — não editável por usuário no MVP, de propósito:
 * previsibilidade e revisão por PR valem mais que flexibilidade aqui. Fica no pacote compartilhado
 * porque o backend decide e o frontend apenas esconde o que já foi negado (doc 07 §1).
 */
export const PERMISSIONS = [
  'dashboard.view',
  'reports.export',
  'alerts.manage',
  'alerts.ack',
  'users.manage',
  'erp_connection.manage',
  'modules.manage',
  'erp.propose',
  'erp.approve',
  'audit.view',
  'billing.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Matriz papel × permissão — cópia fiel da tabela do doc 07 §3. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [
    'dashboard.view',
    'reports.export',
    'alerts.manage',
    'alerts.ack',
    'users.manage',
    'erp_connection.manage',
    'modules.manage',
    'erp.propose',
    'erp.approve',
    'audit.view',
    'billing.manage',
  ],
  admin: [
    'dashboard.view',
    'reports.export',
    'alerts.manage',
    'alerts.ack',
    'users.manage',
    'erp_connection.manage',
    'modules.manage',
    'erp.propose',
    'erp.approve',
    'audit.view',
  ],
  manager: ['dashboard.view', 'reports.export', 'alerts.manage', 'alerts.ack', 'erp.propose'],
  analyst: ['dashboard.view', 'reports.export', 'alerts.ack'],
  viewer: ['dashboard.view'],
  auditor: ['dashboard.view', 'audit.view'],
};

/**
 * Papéis que exigem MFA (doc 06 §MFA): quem administra o tenant não entra sem segundo fator.
 */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['owner', 'admin'];

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

export function requiresMfa(role: Role): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}

/** Permissões concedidas por flag na membership, fora da matriz do papel (doc 07 §3, nota *). */
export const GRANTABLE_PERMISSIONS: readonly Permission[] = ['erp.approve'];
