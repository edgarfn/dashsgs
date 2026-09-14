import { requiresMfa, type LoginStatus, type MeResponse, type Role } from '@dashsgs/shared';
import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { AuditService } from '../../../common/audit';
import { HashingService } from '../../../common/crypto';
import { AppException } from '../../../common/errors/app.exception';
import { MailService, securityNoticeEmail } from '../../../common/mail';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RATE_LIMITS, RateLimiterService } from '../../../common/rate-limit';
import { type AuthContext, type RequestIdentity } from '../../../common/auth';
import { type LoginInput } from '../dto/auth.dto';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

/**
 * Hash descartável usado quando o e-mail não existe. Sem isso, "usuário inexistente" responderia
 * em 2 ms e "senha errada" em 60 ms — e a diferença enumera contas (doc 06 §3).
 * Gerado no boot para não virar um valor fixo em disco.
 */
const DUMMY_PASSWORD = 'dashsgs-timing-equalizer';

/** Bloqueio incremental a partir da 5ª falha: 1, 2, 4, 8, 15 minutos (teto). */
const LOCK_THRESHOLD = 5;
const LOCK_MAX_MINUTES = 15;

export function lockMinutesFor(failedAttempts: number): number {
  if (failedAttempts < LOCK_THRESHOLD) return 0;
  return Math.min(LOCK_MAX_MINUTES, 2 ** (failedAttempts - LOCK_THRESHOLD));
}

export interface LoginResult {
  status: LoginStatus;
  /** Cookies já aplicados na resposta; o controller só devolve o status. */
  userId: string;
}

@Injectable()
export class AuthService {
  private dummyHash: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    private readonly rateLimiter: RateLimiterService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /**
   * Login com e-mail e senha (doc 06 §Fluxos).
   *
   * Toda saída de erro é a mesma — `AUTH_INVALID_CREDENTIALS` — exista ou não a conta, esteja
   * ela desativada ou sem senha definida. O que diferencia os casos é a auditoria, que é interna.
   */
  async login(input: LoginInput, identity: RequestIdentity, res: Response): Promise<LoginResult> {
    await this.enforceRateLimit(`login:ip:${identity.ip ?? 'desconhecido'}`, RATE_LIMITS.loginByIp);

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { memberships: { include: { tenant: true } } },
    });

    if (!user) {
      // Equaliza o tempo de resposta antes de recusar.
      await this.hashing.verifyPassword(await this.getDummyHash(), input.password);
      await this.auditLoginFailure(null, identity, 'usuario_inexistente');
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    await this.enforceRateLimit(`login:acct:${user.id}`, RATE_LIMITS.loginByAccount);

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.auditLoginFailure(user.id, identity, 'conta_bloqueada');
      throw new AppException('AUTH_LOCKED');
    }

    const passwordOk = await this.hashing.verifyPassword(user.passwordHash, input.password);
    if (!passwordOk || user.status !== 'active' || user.deletedAt) {
      await this.registerFailure(user.id, user.failedAttempts, identity, !passwordOk);
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    // Tenant suspenso bloqueia o login dos membros — os dados ficam, o acesso para (doc 08 §5).
    // Contas da plataforma passam: são elas que reativam o contrato.
    const vinculosUsaveis = user.memberships.filter(
      (membership) => !membership.tenant.deletedAt && membership.tenant.status === 'active',
    );
    if (!user.platformAdmin && user.memberships.length > 0 && vinculosUsaveis.length === 0) {
      await this.auditLoginFailure(user.id, identity, 'tenant_suspenso');
      throw new AppException('FORBIDDEN', {
        message: 'Acesso suspenso para este contrato. Fale com o administrador da sua rede.',
      });
    }

    const roles = vinculosUsaveis.map((membership) => membership.role as Role);
    const mfaRequired = user.platformAdmin || roles.some((role) => requiresMfa(role));

    // Caso 1: MFA configurado — só há sessão completa com o segundo fator.
    if (user.totpEnabled) {
      if (!input.totp) {
        await this.startPartialSession(user.id, identity, res);
        await this.audit.record({
          action: 'auth.login.mfa_required',
          resourceType: 'session',
          result: 'success',
          userId: user.id,
          ip: identity.ip,
          userAgent: identity.userAgent,
        });
        return { status: 'mfa_required', userId: user.id };
      }

      const codeOk = await this.totp.verify(user.id, user.email, input.totp);
      if (!codeOk) {
        await this.registerFailure(user.id, user.failedAttempts, identity, true, 'totp_invalido');
        throw new AppException('AUTH_INVALID_CREDENTIALS');
      }
    }

    // Caso 2: papel exige MFA e a conta ainda não tem — sessão parcial só para cadastrar.
    if (!user.totpEnabled && mfaRequired) {
      await this.startPartialSession(user.id, identity, res);
      await this.audit.record({
        action: 'auth.login.mfa_enrollment_required',
        resourceType: 'session',
        result: 'success',
        userId: user.id,
        ip: identity.ip,
        userAgent: identity.userAgent,
      });
      return { status: 'mfa_enrollment_required', userId: user.id };
    }

    const created = await this.sessions.create(user.id, identity, {
      mfaPassed: true,
      // Vínculo único: já nasce com o tenant fixado. Com vários, a escolha vem depois
      // (POST /auth/tenant) — adivinhar aqui seria pior que perguntar.
      tenantId: vinculosUsaveis.length === 1 ? vinculosUsaveis[0]!.tenantId : null,
    });
    this.sessions.setCookies(res, created);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.rateLimiter.reset(`login:acct:${user.id}`);
    await this.audit.record({
      action: 'auth.login.succeeded',
      resourceType: 'session',
      resourceId: created.sessionId,
      result: 'success',
      userId: user.id,
      sessionId: created.sessionId,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { mfa: user.totpEnabled ? 'totp' : 'nenhum' },
    });

    return { status: 'authenticated', userId: user.id };
  }

  /** Conclui o desafio de MFA de uma sessão parcial, rotacionando o id (anti-fixation). */
  async completeMfa(
    auth: AuthContext,
    identity: RequestIdentity,
    res: Response,
    input: { totp?: string; recoveryCode?: string },
  ): Promise<void> {
    await this.enforceRateLimit(`totp:${auth.user.id}`, RATE_LIMITS.totpVerify);

    const ok = input.totp
      ? await this.totp.verify(auth.user.id, auth.user.email, input.totp)
      : await this.totp.consumeRecoveryCode(auth.user.id, input.recoveryCode ?? '');

    if (!ok) {
      await this.audit.record({
        action: 'auth.mfa.failed',
        resourceType: 'session',
        resourceId: auth.session.id,
        result: 'denied',
        userId: auth.user.id,
        sessionId: auth.session.id,
        ip: identity.ip,
        userAgent: identity.userAgent,
        changes: { metodo: input.totp ? 'totp' : 'codigo_recuperacao' },
      });
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    const rotated = await this.sessions.rotate(auth.session.id, identity);
    this.sessions.setCookies(res, rotated);

    await this.prisma.user.update({
      where: { id: auth.user.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.rateLimiter.reset(`totp:${auth.user.id}`);
    await this.audit.record({
      action: 'auth.mfa.succeeded',
      resourceType: 'session',
      resourceId: rotated.sessionId,
      result: 'success',
      userId: auth.user.id,
      sessionId: rotated.sessionId,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: {
        metodo: input.totp ? 'totp' : 'codigo_recuperacao',
        codigosRestantes: input.recoveryCode
          ? await this.totp.countUnusedRecoveryCodes(auth.user.id)
          : undefined,
      },
    });

    if (input.recoveryCode) {
      // Uso de código de recuperação é sinal de perda do dispositivo: o dono precisa saber.
      await this.mail.send(
        securityNoticeEmail({
          to: auth.user.email,
          event: 'mfa_enabled',
          when: new Date(),
          ip: identity.ip,
        }),
      );
    }
  }

  async logout(auth: AuthContext, identity: RequestIdentity, res: Response): Promise<void> {
    await this.sessions.revoke(auth.session.id);
    this.sessions.clearCookies(res);
    await this.audit.record({
      action: 'auth.logout',
      resourceType: 'session',
      resourceId: auth.session.id,
      result: 'success',
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
    });
  }

  /** Monta o /me — a fonte que o front usa para desenhar menu e esconder ações (doc 07 §1). */
  buildMe(auth: AuthContext): MeResponse {
    return {
      user: {
        id: auth.user.id,
        email: auth.user.email,
        name: auth.user.name,
        totpEnabled: auth.user.totpEnabled,
        lastLoginAt: auth.user.lastLoginAt?.toISOString() ?? null,
        platformAdmin: auth.user.platformAdmin,
      },
      memberships: auth.memberships.map((membership) => ({
        tenantId: membership.tenantId,
        tenantName: membership.tenantName,
        tenantSlug: membership.tenantSlug,
        role: membership.role,
        filiaisAllowed: membership.filiaisAllowed,
        ...(membership.viaBreakGlass ? { viaBreakGlass: true } : {}),
      })),
      activeTenantId: auth.activeTenantId,
      permissions: auth.permissions,
      mfa: {
        required: auth.mfaRequired,
        enabled: auth.user.totpEnabled,
        verifiedRecently: this.sessions.isMfaRecent(auth.session.mfaVerifiedAt),
      },
    };
  }

  private async startPartialSession(
    userId: string,
    identity: RequestIdentity,
    res: Response,
    tenantId?: string | null,
  ): Promise<void> {
    const created = await this.sessions.create(userId, identity, { mfaPassed: false, tenantId });
    this.sessions.setCookies(res, created);
  }

  private async registerFailure(
    userId: string,
    currentFailures: number,
    identity: RequestIdentity,
    countAttempt: boolean,
    reason = 'senha_invalida',
  ): Promise<void> {
    if (!countAttempt) {
      await this.auditLoginFailure(userId, identity, reason);
      return;
    }

    const failedAttempts = currentFailures + 1;
    const lockMinutes = lockMinutesFor(failedAttempts);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedAttempts,
        lockedUntil: lockMinutes > 0 ? new Date(Date.now() + lockMinutes * 60_000) : null,
      },
    });

    await this.auditLoginFailure(userId, identity, reason, { failedAttempts, lockMinutes });
  }

  private async auditLoginFailure(
    userId: string | null,
    identity: RequestIdentity,
    reason: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.record({
      action: 'auth.login.failed',
      resourceType: 'session',
      result: 'denied',
      userId,
      ip: identity.ip,
      userAgent: identity.userAgent,
      // `reason` é interno: a resposta HTTP continua genérica.
      changes: { reason, ...extra },
    });
  }

  private async enforceRateLimit(
    key: string,
    rule: { limit: number; windowSeconds: number },
  ): Promise<void> {
    const result = await this.rateLimiter.consume(key, rule);
    if (!result.allowed) {
      throw new AppException('RATE_LIMITED', {
        logContext: { key, retryAfterSeconds: result.retryAfterSeconds },
      });
    }
  }

  private async getDummyHash(): Promise<string> {
    this.dummyHash ??= await this.hashing.hashPassword(DUMMY_PASSWORD);
    return this.dummyHash;
  }
}
