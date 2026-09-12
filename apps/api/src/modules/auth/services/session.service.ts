import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  MFA_RECENT_WINDOW_MINUTES,
  SESSION_ABSOLUTE_TTL_HOURS,
  SESSION_IDLE_TTL_MINUTES,
  permissionsForRole,
  requiresMfa,
  type Permission,
  type Role,
} from '@dashsgs/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { AppConfigService, ENV } from '../../../config';
import { type Env } from '../../../config/env.schema';
import { HashingService } from '../../../common/crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type AuthContext, type RequestIdentity } from '../../../common/auth';

/** Nome dos cookies. O prefixo `__Host-` exige Secure + Path=/ + sem Domain (doc 09 §1). */
export const SESSION_COOKIE = { prod: '__Host-dashsgs_session', dev: 'dashsgs_session' } as const;
export const CSRF_COOKIE = { prod: '__Host-dashsgs_csrf', dev: 'dashsgs_csrf' } as const;

interface CreatedSession {
  token: string;
  sessionId: string;
  csrfToken: string;
  expiresAt: Date;
}

/**
 * Sessões server-side (ADR-004 / doc 06 §1).
 *
 * O navegador carrega apenas um token opaco de 256 bits; o banco guarda o SHA-256 dele. Isso dá
 * revogação imediata (logout, troca de senha, bloqueio de conta) — o que um JWT no browser não dá.
 */
@Injectable()
export class SessionService {
  private readonly csrfSecret: string;

  constructor(
    @Inject(ENV) env: Env,
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly config: AppConfigService,
  ) {
    this.csrfSecret = env.CSRF_SECRET;
  }

  get sessionCookieName(): string {
    return this.config.isProduction ? SESSION_COOKIE.prod : SESSION_COOKIE.dev;
  }

  get csrfCookieName(): string {
    return this.config.isProduction ? CSRF_COOKIE.prod : CSRF_COOKIE.dev;
  }

  async create(
    userId: string,
    identity: RequestIdentity,
    options: { mfaPassed: boolean; tenantId?: string | null } = { mfaPassed: false },
  ): Promise<CreatedSession> {
    const token = this.hashing.generateToken();
    const sessionId = this.hashing.hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_HOURS * 3_600_000);

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId,
        tenantId: options.tenantId ?? null,
        ip: identity.ip,
        userAgent: identity.userAgent?.slice(0, 255) ?? null,
        mfaPassed: options.mfaPassed,
        mfaVerifiedAt: options.mfaPassed ? now : null,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
      },
    });

    return { token, sessionId, csrfToken: this.csrfTokenFor(sessionId), expiresAt };
  }

  /**
   * Troca o token de uma sessão preservando seu estado (fixation: o id que o usuário carregava
   * antes de provar o segundo fator não vale depois dele — doc 06 §3).
   */
  async rotate(sessionId: string, identity: RequestIdentity): Promise<CreatedSession> {
    const current = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!current) throw new Error('sessão inexistente na rotação');

    const token = this.hashing.generateToken();
    const newId = this.hashing.hashToken(token);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.session.create({
        data: {
          id: newId,
          userId: current.userId,
          tenantId: current.tenantId,
          ip: identity.ip ?? current.ip,
          userAgent: identity.userAgent?.slice(0, 255) ?? current.userAgent,
          mfaPassed: true,
          mfaVerifiedAt: now,
          createdAt: current.createdAt,
          lastSeenAt: now,
          // Mantém o teto absoluto da sessão original: rotacionar não estende a validade.
          expiresAt: current.expiresAt,
        },
      }),
      this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: now } }),
    ]);

    return {
      token,
      sessionId: newId,
      csrfToken: this.csrfTokenFor(newId),
      expiresAt: current.expiresAt,
    };
  }

  /**
   * Resolve o token do cookie em contexto autenticado, aplicando expiração absoluta (12 h),
   * inatividade (60 min) e estado de conta/tenant. Devolve null em qualquer inconsistência —
   * o chamador traduz para 401 sem dizer qual das condições falhou.
   */
  async resolve(token: string): Promise<AuthContext | null> {
    const sessionId = this.hashing.hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        user: {
          include: {
            memberships: { include: { tenant: true } },
          },
        },
      },
    });

    if (!session || session.revokedAt) return null;

    const now = new Date();
    if (session.expiresAt <= now) return null;

    const idleDeadline = new Date(session.lastSeenAt.getTime() + SESSION_IDLE_TTL_MINUTES * 60_000);
    if (idleDeadline <= now) {
      await this.revoke(sessionId);
      return null;
    }

    const user = session.user;
    if (user.deletedAt || user.status !== 'active') return null;

    const memberships = user.memberships
      .filter((membership) => !membership.tenant.deletedAt)
      .map((membership) => ({
        tenantId: membership.tenantId,
        tenantName: membership.tenant.name,
        tenantSlug: membership.tenant.slug,
        tenantStatus: membership.tenant.status as 'active' | 'suspended',
        role: membership.role as Role,
        filiaisAllowed: membership.filiaisAllowed,
      }));

    // Tenant suspenso bloqueia o acesso dos membros, mas preserva os dados (doc 08 §5).
    const usable = memberships.filter((membership) => membership.tenantStatus === 'active');
    const activeTenantId =
      usable.find((membership) => membership.tenantId === session.tenantId)?.tenantId ??
      (usable.length === 1 ? (usable[0]?.tenantId ?? null) : null);

    const activeMembership = usable.find((membership) => membership.tenantId === activeTenantId);

    return {
      session: {
        id: session.id,
        mfaPassed: session.mfaPassed,
        mfaVerifiedAt: session.mfaVerifiedAt,
        tenantId: activeTenantId,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
      },
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        totpEnabled: user.totpEnabled,
        lastLoginAt: user.lastLoginAt,
        platformAdmin: user.platformAdmin,
      },
      memberships,
      activeTenantId,
      permissions: activeMembership ? [...permissionsForRole(activeMembership.role)] : [],
      // Operar a plataforma também exige segundo fator, mesmo sem vínculo com tenant algum.
      mfaRequired:
        user.platformAdmin || memberships.some((membership) => requiresMfa(membership.role)),
    };
  }

  /** Renovação deslizante — só escreve quando passou tempo suficiente (1 write/min por sessão). */
  async touch(sessionId: string, lastSeenAt: Date): Promise<void> {
    if (Date.now() - lastSeenAt.getTime() < 60_000) return;
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastSeenAt: new Date() },
    });
  }

  async markMfaVerified(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { mfaPassed: true, mfaVerifiedAt: new Date() },
    });
  }

  async selectTenant(sessionId: string, tenantId: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { tenantId } });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoga todas as sessões do usuário (troca de senha, reset, bloqueio) — doc 06 §Fluxos. */
  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async listActive(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
      },
    });
  }

  /** Uma verificação de MFA "recente" habilita ações sensíveis (doc 07 §4.3). */
  isMfaRecent(mfaVerifiedAt: Date | null): boolean {
    if (!mfaVerifiedAt) return false;
    return Date.now() - mfaVerifiedAt.getTime() <= MFA_RECENT_WINDOW_MINUTES * 60_000;
  }

  /**
   * Token anti-CSRF derivado da sessão (double-submit): não precisa de armazenamento e é
   * inútil em outra sessão. Quem não tem o cookie de sessão não consegue forjar o par.
   */
  csrfTokenFor(sessionId: string): string {
    return createHmac('sha256', this.csrfSecret).update(sessionId).digest('base64url');
  }

  verifyCsrfToken(sessionId: string, candidate: string | undefined): boolean {
    if (!candidate) return false;
    const expected = Buffer.from(this.csrfTokenFor(sessionId));
    const received = Buffer.from(candidate);
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  }

  /** Aplica os cookies na resposta. Em produção: `__Host-`, Secure, HttpOnly, SameSite=Lax. */
  setCookies(res: Response, created: CreatedSession): void {
    const secure = this.config.isProduction;
    const maxAge = created.expiresAt.getTime() - Date.now();

    res.cookie(this.sessionCookieName, created.token, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge,
    });

    // HttpOnly também no cookie de CSRF: quem lê e reenvia é o BFF (servidor), não script de
    // página. Reduz a superfície caso algum dia um XSS escape da CSP.
    res.cookie(this.csrfCookieName, created.csrfToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
  }

  clearCookies(res: Response): void {
    const options = {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax' as const,
      path: '/',
    };
    res.clearCookie(this.sessionCookieName, options);
    res.clearCookie(this.csrfCookieName, options);
  }

  permissionsFor(role: Role): Permission[] {
    return [...permissionsForRole(role)];
  }
}
