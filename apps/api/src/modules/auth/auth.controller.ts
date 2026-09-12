import {
  type LoginResponse,
  type MeResponse,
  type SessionSummary,
  type TotpEnableResponse,
  type TotpSetupResponse,
} from '@dashsgs/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuditService } from '../../common/audit';
import { AppException } from '../../common/errors/app.exception';
import { MailService, securityNoticeEmail } from '../../common/mail';
import { HashingService } from '../../common/crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import {
  AllowPendingMfa,
  CurrentAuth,
  Identity,
  Public,
  RequireRecentMfa,
} from '../../common/auth';
import {
  loginSchema,
  passwordChangeSchema,
  passwordForgotSchema,
  passwordResetSchema,
  selectTenantSchema,
  totpDisableSchema,
  totpEnableSchema,
  totpVerifySchema,
  type LoginInput,
  type PasswordChangeInput,
  type PasswordForgotInput,
  type PasswordResetInput,
  type SelectTenantInput,
  type TotpDisableInput,
  type TotpEnableInput,
  type TotpVerifyInput,
} from './dto/auth.dto';
import { AuthService } from './services/auth.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';
import { TotpService } from './services/totp.service';

/** Rotas de autenticação (doc 23 §Auth). Prefixo global `/api/v1` aplicado no bootstrap. */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    private readonly hashing: HashingService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Identity() identity: RequestIdentity,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.login(body, identity, res);
    return { status: result.status };
  }

  @Post('logout')
  @AllowPendingMfa()
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth, identity, res);
  }

  /** Conclui o desafio de MFA de uma sessão parcial (código do app ou de recuperação). */
  @Post('mfa/verify')
  @AllowPendingMfa()
  @HttpCode(204)
  async verifyMfa(
    @Body(new ZodValidationPipe(totpVerifySchema)) body: TotpVerifyInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (!auth.user.totpEnabled) {
      throw new AppException('VALIDATION_ERROR', {
        message: 'Esta conta ainda não tem verificação em duas etapas configurada.',
        details: [{ path: 'totp', rule: 'mfa_not_enrolled' }],
      });
    }
    await this.auth.completeMfa(auth, identity, res, body);
  }

  /** Gera o segredo e o QR. Continua disponível com sessão parcial: é o caminho do enrollment. */
  @Post('mfa/setup')
  @AllowPendingMfa()
  @HttpCode(200)
  async setupMfa(@CurrentAuth() auth: AuthContext): Promise<TotpSetupResponse> {
    if (auth.user.totpEnabled) {
      throw new AppException('CONFLICT', {
        message: 'A verificação em duas etapas já está ativa. Desative antes de cadastrar outra.',
      });
    }
    return this.totp.startSetup(auth.user.id, auth.user.email);
  }

  @Post('mfa/enable')
  @AllowPendingMfa()
  @HttpCode(200)
  async enableMfa(
    @Body(new ZodValidationPipe(totpEnableSchema)) body: TotpEnableInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TotpEnableResponse> {
    const recoveryCodes = await this.totp.enable(auth.user.id, auth.user.email, body.totp);
    if (!recoveryCodes) {
      throw new AppException('VALIDATION_ERROR', {
        message: 'Código inválido ou cadastro expirado. Gere um novo QR e tente de novo.',
        details: [{ path: 'totp', rule: 'invalid_code' }],
      });
    }

    // Quem acabou de provar o segundo fator sai daqui com sessão completa e token novo.
    const rotated = await this.sessions.rotate(auth.session.id, identity);
    this.sessions.setCookies(res, rotated);

    await this.mail.send(
      securityNoticeEmail({
        to: auth.user.email,
        event: 'mfa_enabled',
        when: new Date(),
        ip: identity.ip,
      }),
    );
    await this.audit.record({
      action: 'auth.mfa.enabled',
      resourceType: 'user',
      resourceId: auth.user.id,
      result: 'success',
      userId: auth.user.id,
      sessionId: rotated.sessionId,
      ip: identity.ip,
      userAgent: identity.userAgent,
    });

    return { recoveryCodes };
  }

  /**
   * Desativar MFA exige senha **e** código válido: só o dono do fator, com o dispositivo em mãos,
   * consegue remover a proteção (sessão roubada não basta).
   */
  @Post('mfa/disable')
  @HttpCode(204)
  async disableMfa(
    @Body(new ZodValidationPipe(totpDisableSchema)) body: TotpDisableInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<void> {
    if (auth.mfaRequired) {
      throw AppException.forbidden({
        reason: 'papel exige MFA',
        roles: auth.memberships.map((membership) => membership.role),
      });
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    const passwordOk = await this.hashing.verifyPassword(user.passwordHash, body.password);
    const codeOk = await this.totp.verify(auth.user.id, auth.user.email, body.totp);
    if (!passwordOk || !codeOk) {
      await this.audit.record({
        action: 'auth.mfa.disable_denied',
        resourceType: 'user',
        resourceId: auth.user.id,
        result: 'denied',
        userId: auth.user.id,
        sessionId: auth.session.id,
        ip: identity.ip,
        userAgent: identity.userAgent,
      });
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    await this.totp.disable(auth.user.id);
    await this.mail.send(
      securityNoticeEmail({
        to: auth.user.email,
        event: 'mfa_disabled',
        when: new Date(),
        ip: identity.ip,
      }),
    );
    await this.audit.record({
      action: 'auth.mfa.disabled',
      resourceType: 'user',
      resourceId: auth.user.id,
      result: 'success',
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
    });
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  async forgotPassword(
    @Body(new ZodValidationPipe(passwordForgotSchema)) body: PasswordForgotInput,
    @Identity() identity: RequestIdentity,
  ): Promise<{ status: 'accepted' }> {
    await this.passwords.requestReset(body.email, identity);
    // Resposta idêntica exista ou não a conta (doc 06 §3 — enumeração).
    return { status: 'accepted' };
  }

  @Post('password/reset')
  @Public()
  @HttpCode(204)
  async resetPassword(
    @Body(new ZodValidationPipe(passwordResetSchema)) body: PasswordResetInput,
    @Identity() identity: RequestIdentity,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.passwords.resetWithToken(body.token, body.password, identity);
    // Todas as sessões caíram, inclusive a de quem está com o navegador aberto aqui.
    this.sessions.clearCookies(res);
  }

  @Post('password/change')
  @HttpCode(204)
  async changePassword(
    @Body(new ZodValidationPipe(passwordChangeSchema)) body: PasswordChangeInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<void> {
    await this.passwords.change(auth, body.currentPassword, body.newPassword, identity);
  }

  @Get('sessions')
  async listSessions(@CurrentAuth() auth: AuthContext): Promise<SessionSummary[]> {
    const sessions = await this.sessions.listActive(auth.user.id);
    return sessions.map((session) => ({
      id: session.id,
      ip: session.ip,
      userAgent: session.userAgent,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === auth.session.id,
    }));
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // Revogar sessão de outra pessoa não é "não autorizado", é "não existe" (doc 08 §4).
    const target = await this.prisma.session.findFirst({
      where: { id, userId: auth.user.id, revokedAt: null },
    });
    if (!target) throw AppException.notFound({ sessionId: id });

    await this.sessions.revoke(id);
    if (id === auth.session.id) this.sessions.clearCookies(res);

    await this.audit.record({
      action: 'auth.session.revoked',
      resourceType: 'session',
      resourceId: id,
      result: 'success',
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { propria: id === auth.session.id },
    });
  }

  /** Escolhe o tenant ativo da sessão (usuário com mais de um vínculo). */
  @Post('tenant')
  @HttpCode(204)
  async selectTenant(
    @Body(new ZodValidationPipe(selectTenantSchema)) body: SelectTenantInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    const membership = auth.memberships.find(
      (item) => item.tenantId === body.tenantId && item.tenantStatus === 'active',
    );
    if (!membership) throw AppException.notFound({ tenantId: body.tenantId });
    await this.sessions.selectTenant(auth.session.id, body.tenantId);
  }
}

/** `/me` fica fora do controller de auth porque é o perfil, não o fluxo (doc 23). */
@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  me(@CurrentAuth() auth: AuthContext): MeResponse {
    return this.auth.buildMe(auth);
  }

  /** Perfil acessível com MFA pendente: a tela de enrollment precisa saber quem é o usuário. */
  @Get('pending')
  @AllowPendingMfa()
  pending(@CurrentAuth() auth: AuthContext): MeResponse {
    return this.auth.buildMe(auth);
  }
}

/** Ações sensíveis do perfil que exigem MFA recente ficam aqui para deixar a regra visível. */
@Controller('me/security')
export class MeSecurityController {
  constructor(private readonly totp: TotpService) {}

  @Get('recovery-codes/count')
  @RequireRecentMfa()
  async recoveryCodesRemaining(@CurrentAuth() auth: AuthContext): Promise<{ remaining: number }> {
    return { remaining: await this.totp.countUnusedRecoveryCodes(auth.user.id) };
  }
}
