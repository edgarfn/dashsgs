import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController, MeController, MeSecurityController } from './auth.controller';
import { CsrfGuard } from './guards/csrf.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { SessionGuard } from './guards/session.guard';
import { InvitesController } from './invites.controller';
import { AuthService } from './services/auth.service';
import { InviteService } from './services/invite.service';
import { PasswordPolicyService } from './services/password-policy.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';
import { TotpService } from './services/totp.service';

/**
 * Autenticação e autorização (Fase 3 / épico E2).
 *
 * Os três guards são **globais** e nesta ordem:
 *   1. sessão   — resolve o cookie; sem `@Public()` a rota exige sessão (padrão fechado);
 *   2. CSRF     — mutação autenticada precisa do token double-submit;
 *   3. permissões — RBAC do doc 07 + exigência de MFA recente em ação sensível.
 */
@Module({
  controllers: [AuthController, MeController, MeSecurityController, InvitesController],
  providers: [
    AuthService,
    SessionService,
    TotpService,
    PasswordService,
    PasswordPolicyService,
    InviteService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [SessionService, AuthService, InviteService],
})
export class AuthModule {}
