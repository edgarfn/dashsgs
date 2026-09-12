import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit';
import { HashingService } from '../../../common/crypto';
import { AppException } from '../../../common/errors/app.exception';
import { MailService, passwordResetEmail, securityNoticeEmail } from '../../../common/mail';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RATE_LIMITS, RateLimiterService } from '../../../common/rate-limit';
import { AppConfigService } from '../../../config';
import { type AuthContext, type RequestIdentity } from '../../../common/auth';
import { PasswordPolicyService } from './password-policy.service';
import { SessionService } from './session.service';

/** Token de recuperação vale 30 minutos e uma única vez (doc 06 §Fluxos). */
const RESET_TTL_MINUTES = 30;

@Injectable()
export class PasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly policy: PasswordPolicyService,
    private readonly sessions: SessionService,
    private readonly rateLimiter: RateLimiterService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Pedido de recuperação. A resposta é **sempre** a mesma, exista ou não a conta — quem tenta
   * descobrir se um e-mail está cadastrado não aprende nada aqui (doc 06 §3).
   */
  async requestReset(email: string, identity: RequestIdentity): Promise<void> {
    const limit = await this.rateLimiter.consume(
      `forgot:ip:${identity.ip ?? 'desconhecido'}`,
      RATE_LIMITS.passwordForgot,
    );
    if (!limit.allowed) {
      throw new AppException('RATE_LIMITED', {
        logContext: { retryAfterSeconds: limit.retryAfterSeconds },
      });
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt || user.status === 'disabled') {
      await this.audit.record({
        action: 'auth.password.reset_requested',
        resourceType: 'user',
        result: 'denied',
        userId: user?.id ?? null,
        ip: identity.ip,
        userAgent: identity.userAgent,
        changes: { reason: 'conta_inexistente_ou_desativada' },
      });
      return;
    }

    const token = this.hashing.generateToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);

    await this.prisma.$transaction([
      // Um pedido novo invalida os anteriores: só o último link funciona.
      this.prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordReset.create({
        data: { userId: user.id, tokenHash: this.hashing.hashToken(token), expiresAt },
      }),
    ]);

    await this.mail.send(
      passwordResetEmail({
        to: user.email,
        url: `${this.config.appUrl}/redefinir-senha?token=${encodeURIComponent(token)}`,
        expiresInMinutes: RESET_TTL_MINUTES,
      }),
    );

    await this.audit.record({
      action: 'auth.password.reset_requested',
      resourceType: 'user',
      resourceId: user.id,
      result: 'success',
      userId: user.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
    });
  }

  /** Redefine a senha pelo token e derruba todas as sessões abertas (doc 06 §Fluxos). */
  async resetWithToken(
    token: string,
    newPassword: string,
    identity: RequestIdentity,
  ): Promise<void> {
    const tokenHash = this.hashing.hashToken(token);
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!reset || reset.usedAt || reset.expiresAt <= new Date() || reset.user.deletedAt) {
      throw new AppException('VALIDATION_ERROR', {
        message: 'Link de redefinição inválido ou expirado. Peça um novo.',
        details: [{ path: 'token', rule: 'invalid_or_expired' }],
      });
    }

    await this.policy.assertAcceptable(newPassword, [reset.user.email, reset.user.name]);
    const passwordHash = await this.hashing.hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash,
          // Redefinir senha destrava a conta: quem provou o e-mail não é o atacante do lockout.
          failedAttempts: 0,
          lockedUntil: null,
          status: reset.user.status === 'invited' ? 'active' : reset.user.status,
        },
      }),
      this.prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
    ]);

    const revoked = await this.sessions.revokeAllForUser(reset.userId);

    await this.mail.send(
      securityNoticeEmail({
        to: reset.user.email,
        event: 'password_changed',
        when: new Date(),
        ip: identity.ip,
      }),
    );
    await this.audit.record({
      action: 'auth.password.reset',
      resourceType: 'user',
      resourceId: reset.userId,
      result: 'success',
      userId: reset.userId,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { sessoesRevogadas: revoked },
    });
  }

  /** Troca com senha atual: mantém a sessão corrente e derruba as demais (doc 06 §Fluxos). */
  async change(
    auth: AuthContext,
    currentPassword: string,
    newPassword: string,
    identity: RequestIdentity,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });

    const ok = await this.hashing.verifyPassword(user.passwordHash, currentPassword);
    if (!ok) {
      await this.audit.record({
        action: 'auth.password.change_denied',
        resourceType: 'user',
        resourceId: user.id,
        result: 'denied',
        userId: user.id,
        ip: identity.ip,
        userAgent: identity.userAgent,
        changes: { reason: 'senha_atual_incorreta' },
      });
      throw new AppException('AUTH_INVALID_CREDENTIALS', {
        message: 'Senha atual incorreta.',
      });
    }

    await this.policy.assertAcceptable(newPassword, [user.email, user.name]);
    const passwordHash = await this.hashing.hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    const revoked = await this.sessions.revokeAllForUser(user.id, auth.session.id);

    await this.mail.send(
      securityNoticeEmail({
        to: user.email,
        event: 'password_changed',
        when: new Date(),
        ip: identity.ip,
      }),
    );
    await this.audit.record({
      action: 'auth.password.changed',
      resourceType: 'user',
      resourceId: user.id,
      result: 'success',
      userId: user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { sessoesRevogadas: revoked },
    });
  }
}
