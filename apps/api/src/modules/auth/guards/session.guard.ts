import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { setCorrelationFields } from '../../../common/correlation/correlation.context';
import { AppException } from '../../../common/errors/app.exception';
import { ALLOW_PENDING_MFA, IS_PUBLIC } from '../../../common/auth';
import { SessionService } from '../services/session.service';

/**
 * Guard global de sessão (doc 06 §1).
 *
 * O padrão é **fechado**: sem `@Public()`, a rota exige sessão válida. Rotas públicas ainda
 * tentam resolver a sessão, porque `/auth/login` precisa saber se já existe uma (e a auditoria
 * gosta de saber quem estava logado).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const allowPendingMfa = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_MFA, [
      context.getHandler(),
      context.getClass(),
    ]);

    const token = request.cookies?.[this.sessions.sessionCookieName];
    if (!token) {
      if (isPublic) return true;
      throw new AppException('AUTH_REQUIRED');
    }

    const auth = await this.sessions.resolve(token);
    if (!auth) {
      // Cookie órfão (sessão revogada, expirada, conta desativada): limpa para não repetir.
      this.sessions.clearCookies(response);
      if (isPublic) return true;
      throw new AppException('AUTH_REQUIRED');
    }

    request.auth = auth;
    setCorrelationFields({
      userId: auth.user.id,
      tenantId: auth.activeTenantId ?? undefined,
      sessionId: auth.session.id,
    });

    // Sessão parcial: senha conferida, segundo fator pendente (ou nem cadastrado ainda).
    const mfaPending = auth.mfaRequired && (!auth.session.mfaPassed || !auth.user.totpEnabled);
    if (mfaPending && !allowPendingMfa && !isPublic) {
      throw new AppException('AUTH_MFA_REQUIRED');
    }

    // Renovação deslizante da inatividade (doc 06 §Fluxos) — escreve no máximo 1×/min.
    await this.sessions.touch(auth.session.id, auth.session.lastSeenAt);
    return true;
  }
}
