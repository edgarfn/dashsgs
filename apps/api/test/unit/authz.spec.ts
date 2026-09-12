import {
  PERMISSIONS,
  ROLES,
  permissionsForRole,
  requiresMfa,
  roleHasPermission,
  type Permission,
  type Role,
} from '@dashsgs/shared';

/**
 * A matriz do doc 07 §3 copiada aqui à mão, de propósito: se alguém mexer no catálogo, este
 * teste falha e obriga a decisão a passar por revisão — que é o ponto de um RBAC estático.
 */
const MATRIZ: Record<Permission, Role[]> = {
  'dashboard.view': ['owner', 'admin', 'manager', 'analyst', 'viewer', 'auditor'],
  'reports.export': ['owner', 'admin', 'manager', 'analyst'],
  'alerts.manage': ['owner', 'admin', 'manager'],
  'alerts.ack': ['owner', 'admin', 'manager', 'analyst'],
  'users.manage': ['owner', 'admin'],
  'erp_connection.manage': ['owner', 'admin'],
  'modules.manage': ['owner', 'admin'],
  'erp.propose': ['owner', 'admin', 'manager'],
  'erp.approve': ['owner', 'admin'],
  'audit.view': ['owner', 'admin', 'auditor'],
  'billing.manage': ['owner'],
};

describe('matriz de permissões (doc 07 §3)', () => {
  const casos = ROLES.flatMap((role) =>
    PERMISSIONS.map((permission) => ({
      role,
      permission,
      esperado: MATRIZ[permission].includes(role),
    })),
  );

  it.each(casos)('$role × $permission → $esperado', ({ role, permission, esperado }) => {
    expect(roleHasPermission(role, permission)).toBe(esperado);
  });

  it('não concede permissão fora do catálogo', () => {
    for (const role of ROLES) {
      for (const permission of permissionsForRole(role)) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it('viewer e auditor não alteram nada', () => {
    const escrita: Permission[] = [
      'alerts.manage',
      'users.manage',
      'erp_connection.manage',
      'modules.manage',
      'erp.propose',
      'erp.approve',
      'billing.manage',
    ];
    for (const permission of escrita) {
      expect(roleHasPermission('viewer', permission)).toBe(false);
      expect(roleHasPermission('auditor', permission)).toBe(false);
    }
  });

  it('exige MFA exatamente de owner e admin (doc 06 §MFA)', () => {
    expect(ROLES.filter((role) => requiresMfa(role))).toEqual(['owner', 'admin']);
  });
});
