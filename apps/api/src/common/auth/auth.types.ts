import { type Permission, type Role } from '@dashsgs/shared';

/** Contexto autenticado que o guard anexa à requisição. Nunca contém segredo. */
export interface AuthContext {
  session: {
    id: string;
    mfaPassed: boolean;
    mfaVerifiedAt: Date | null;
    tenantId: string | null;
    createdAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
  };
  user: {
    id: string;
    email: string;
    name: string;
    totpEnabled: boolean;
    lastLoginAt: Date | null;
    /** Conta de operação da plataforma (doc 07 §2) — MFA obrigatório, sem acesso a dado de tenant. */
    platformAdmin: boolean;
  };
  memberships: Array<{
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    tenantStatus: 'active' | 'suspended';
    role: Role;
    filiaisAllowed: number[];
    /** Vínculo temporário de break-glass, não membership de verdade (doc 07 §4.5). */
    viaBreakGlass?: boolean;
  }>;
  /** Tenant ativo da sessão (ou o único do usuário). */
  activeTenantId: string | null;
  /** Permissões efetivas no tenant ativo. */
  permissions: Permission[];
  /** Algum papel do usuário exige MFA (doc 06 §MFA). */
  mfaRequired: boolean;
  /**
   * Concessão de break-glass em vigor, quando o acesso ao tenant ativo vem dela. Presente
   * apenas para `platform_admin`: é o que transforma cada requisição em linha de relatório.
   */
  breakGlass?: { grantId: string; tenantId: string; expiresAt: Date };
}

declare module 'express' {
  interface Request {
    auth?: AuthContext;
    /** Preenchido pelo middleware de correlação (doc 18 §1). */
    correlationId?: string;
  }
}

export interface RequestIdentity {
  ip: string | null;
  userAgent: string | null;
}
