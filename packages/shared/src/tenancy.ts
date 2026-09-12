/** Papéis de membership (doc 05 §1 / matriz de permissões doc 07). */
export const ROLES = ['owner', 'admin', 'manager', 'analyst', 'viewer', 'auditor'] as const;
export type Role = (typeof ROLES)[number];

export const TENANT_STATUS = ['active', 'suspended'] as const;
export type TenantStatus = (typeof TENANT_STATUS)[number];

export const USER_STATUS = ['invited', 'active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

/** Chave de cache sempre prefixada por tenant (doc 08 §4 — isolamento no Redis). */
export function tenantCacheKey(tenantId: string, ...parts: Array<string | number>): string {
  if (!tenantId) throw new Error('tenantCacheKey exige tenantId (isolamento — doc 08 §4)');
  return ['t', tenantId, ...parts].join(':');
}

/** Lock distribuído por tenant (doc 08 §4). */
export function tenantLockKey(tenantId: string, ...parts: Array<string | number>): string {
  return ['lock', 't', tenantId, ...parts].join(':');
}
