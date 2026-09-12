import { type InvitePreview, type Role } from '@dashsgs/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit';
import { HashingService } from '../../../common/crypto';
import { AppException } from '../../../common/errors/app.exception';
import { inviteEmail, MailService } from '../../../common/mail';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RATE_LIMITS, RateLimiterService } from '../../../common/rate-limit';
import { AppConfigService } from '../../../config';
import { type AuthContext, type RequestIdentity } from '../../../common/auth';
import { type InviteAcceptInput, type InviteCreateInput } from '../dto/auth.dto';
import { PasswordPolicyService } from './password-policy.service';

/** Convite expira em 72 h: tempo de sobra para quem está de folga, curto para quem vazou. */
const INVITE_TTL_HOURS = 72;

@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly policy: PasswordPolicyService,
    private readonly rateLimiter: RateLimiterService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Cria (ou renova) o convite de alguém para um tenant. Não existe auto-registro público:
   * toda conta nasce de um convite vinculado a tenant + papel (doc 06 §Contas e convites).
   */
  async create(
    auth: AuthContext,
    tenantId: string,
    input: InviteCreateInput,
    identity: RequestIdentity,
  ): Promise<{ id: string; expiresAt: Date }> {
    const existingMembership = await this.prisma.membership.findFirst({
      where: { tenantId, user: { email: input.email } },
    });
    if (existingMembership) {
      throw new AppException('CONFLICT', {
        message: 'Esta pessoa já faz parte do tenant.',
      });
    }

    const token = this.hashing.generateToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);

    // Reconvidar substitui o convite anterior em vez de acumular links válidos.
    await this.prisma.invite.updateMany({
      where: { tenantId, email: input.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const invite = await this.prisma.invite.create({
      data: {
        tenantId,
        email: input.email,
        role: input.role,
        filiaisAllowed: input.filiaisAllowed,
        tokenHash: this.hashing.hashToken(token),
        invitedById: auth.user.id,
        expiresAt,
      },
      include: { tenant: true },
    });

    await this.mail.send(
      inviteEmail({
        to: input.email,
        tenantName: invite.tenant.name,
        invitedByName: auth.user.name,
        url: `${this.config.appUrl}/convite?token=${encodeURIComponent(token)}`,
        expiresInHours: INVITE_TTL_HOURS,
      }),
    );

    await this.audit.record({
      action: 'user.invited',
      resourceType: 'invite',
      resourceId: invite.id,
      result: 'success',
      tenantId,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      // E-mail é PII: a redaction do audit mascara o campo, sobra o papel — que é o que importa.
      changes: { email: input.email, role: input.role, filiaisAllowed: input.filiaisAllowed },
    });

    return { id: invite.id, expiresAt };
  }

  /** Dados mínimos para a tela de aceite — sem revelar nada além do necessário. */
  async preview(token: string, identity: RequestIdentity): Promise<InvitePreview> {
    const limit = await this.rateLimiter.consume(
      `invite:ip:${identity.ip ?? 'desconhecido'}`,
      RATE_LIMITS.inviteLookup,
    );
    if (!limit.allowed) {
      throw new AppException('RATE_LIMITED', {
        logContext: { retryAfterSeconds: limit.retryAfterSeconds },
      });
    }

    const invite = await this.findUsable(token);
    const user = await this.prisma.user.findUnique({ where: { email: invite.email } });

    return {
      tenantName: invite.tenant.name,
      email: invite.email,
      role: invite.role as Role,
      existingUser: Boolean(user?.passwordHash),
    };
  }

  /**
   * Aceita o convite: cria a conta (se for a primeira vez) e a membership, em uma transação.
   * Quem já tem conta no DashSGS só ganha o vínculo — não define senha de novo.
   */
  async accept(
    input: InviteAcceptInput,
    identity: RequestIdentity,
  ): Promise<{ userId: string; tenantId: string; email: string }> {
    const invite = await this.findUsable(input.token);
    const existing = await this.prisma.user.findUnique({ where: { email: invite.email } });
    const isNewAccount = !existing?.passwordHash;

    if (isNewAccount) {
      if (!input.password) {
        throw new AppException('VALIDATION_ERROR', {
          message: 'Defina uma senha para criar sua conta.',
          details: [{ path: 'password', rule: 'required' }],
        });
      }
      await this.policy.assertAcceptable(input.password, [invite.email, input.name ?? '']);
    }

    const passwordHash = input.password ? await this.hashing.hashPassword(input.password) : null;
    const name = input.name?.trim() || existing?.name || invite.email.split('@')[0] || 'Usuário';

    const result = await this.prisma.$transaction(async (tx) => {
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              name,
              status: 'active',
              ...(passwordHash && isNewAccount ? { passwordHash } : {}),
            },
          })
        : await tx.user.create({
            data: { email: invite.email, name, passwordHash, status: 'active' },
          });

      await tx.membership.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId: invite.tenantId } },
        update: { role: invite.role, filiaisAllowed: invite.filiaisAllowed },
        create: {
          userId: user.id,
          tenantId: invite.tenantId,
          role: invite.role,
          filiaisAllowed: invite.filiaisAllowed,
        },
      });

      // Marca aceito só se ainda estiver pendente: dois cliques no link não criam dois vínculos.
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new AppException('CONFLICT', { message: 'Este convite já foi utilizado.' });
      }

      return user;
    });

    await this.audit.record({
      action: 'user.invite_accepted',
      resourceType: 'invite',
      resourceId: invite.id,
      result: 'success',
      tenantId: invite.tenantId,
      userId: result.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { role: invite.role, contaNova: isNewAccount },
    });

    return { userId: result.id, tenantId: invite.tenantId, email: invite.email };
  }

  async listPending(tenantId: string) {
    return this.prisma.invite.findMany({
      where: { tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        filiaisAllowed: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  async revoke(
    auth: AuthContext,
    tenantId: string,
    inviteId: string,
    identity: RequestIdentity,
  ): Promise<void> {
    const result = await this.prisma.invite.updateMany({
      where: { id: inviteId, tenantId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // 404 uniforme: convite de outro tenant não existe deste lado (doc 08 §4).
    if (result.count === 0) throw AppException.notFound({ inviteId, tenantId });

    await this.audit.record({
      action: 'user.invite_revoked',
      resourceType: 'invite',
      resourceId: inviteId,
      result: 'success',
      tenantId,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
    });
  }

  private async findUsable(token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: this.hashing.hashToken(token) },
      include: { tenant: true },
    });

    if (
      !invite ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt <= new Date() ||
      invite.tenant.deletedAt ||
      invite.tenant.status !== 'active'
    ) {
      throw new AppException('VALIDATION_ERROR', {
        message: 'Convite inválido, expirado ou já utilizado.',
        details: [{ path: 'token', rule: 'invalid_or_expired' }],
      });
    }

    return invite;
  }
}
