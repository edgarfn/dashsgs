import { type Permission } from './authz';
import { type Role } from './tenancy';

/**
 * Contratos de autenticação da API interna (doc 23 §Auth), compartilhados com o front.
 *
 * Nenhum destes tipos carrega segredo: token de sessão vive só no cookie, e o segredo TOTP
 * aparece uma única vez, na resposta do setup.
 */

/** Resultado do POST /auth/login. */
export type LoginStatus =
  /** Sessão completa: pode navegar. */
  | 'authenticated'
  /** Credenciais ok, falta o código TOTP (usuário já tem MFA configurado). */
  | 'mfa_required'
  /** Papel exige MFA (owner/admin) e o usuário ainda não configurou — precisa cadastrar agora. */
  | 'mfa_enrollment_required';

export interface LoginResponse {
  status: LoginStatus;
}

export interface MembershipSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: Role;
  /** Vazio = todas as filiais do tenant. */
  filiaisAllowed: number[];
}

export interface SessionSummary {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** A sessão que fez a requisição — a UI não deve oferecer "revogar" sem avisar. */
  current: boolean;
}

/** GET /me — o que o front precisa para montar menu e esconder o que o backend já nega. */
export interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string;
    totpEnabled: boolean;
    lastLoginAt: string | null;
    /** Conta de operação da plataforma: habilita o painel de tenants (doc 07 §2). */
    platformAdmin: boolean;
  };
  memberships: MembershipSummary[];
  activeTenantId: string | null;
  /** Permissões efetivas no tenant ativo (vazio se nenhum tenant selecionado). */
  permissions: Permission[];
  mfa: {
    /** Algum papel do usuário exige MFA. */
    required: boolean;
    enabled: boolean;
    /** Verificação recente o bastante para ações sensíveis (doc 07 §4.3). */
    verifiedRecently: boolean;
  };
}

export interface TotpSetupResponse {
  /** Base32 do segredo — exibido uma única vez, para quem não consegue ler o QR. */
  secret: string;
  /** URI otpauth:// para o app autenticador. */
  uri: string;
  /** PNG em data: URI, renderizável sob a CSP (img-src 'self' data:). */
  qrCodeDataUrl: string;
}

export interface TotpEnableResponse {
  /** Códigos de recuperação em claro — a única vez que existem fora do hash. */
  recoveryCodes: string[];
}

export interface InvitePreview {
  tenantName: string;
  email: string;
  role: Role;
  /** Convite para quem já tem conta no DashSGS: basta aceitar, sem definir senha. */
  existingUser: boolean;
}

/** Política de senha (doc 06 §Senhas) — o front valida antes de enviar, o backend decide. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;
/** zxcvbn: 0 (péssima) a 4 (excelente); exigimos 3. */
export const PASSWORD_MIN_SCORE = 3;

export interface PasswordFeedback {
  score: number;
  acceptable: boolean;
  warning?: string;
  suggestions: string[];
}

/** Duração da sessão (doc 06 §Fluxos). */
export const SESSION_ABSOLUTE_TTL_HOURS = 12;
export const SESSION_IDLE_TTL_MINUTES = 60;
/** Janela em que uma verificação de MFA ainda vale para ações sensíveis. */
export const MFA_RECENT_WINDOW_MINUTES = 15;
