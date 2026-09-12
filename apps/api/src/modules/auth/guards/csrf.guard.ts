import { CSRF_HEADER } from '@dashsgs/shared';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../../../common/errors/app.exception';
import { IS_PUBLIC } from '../../../common/auth';
import { SessionService } from '../services/session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Anti-CSRF em mutações (doc 09 §1), no esquema double-submit: o cookie `*_csrf` é um HMAC do id
 * da sessão e precisa voltar no header `X-CSRF-Token`.
 *
 * É a terceira camada, não a primeira: o cookie de sessão é `SameSite=Lax` (navegador não o envia
 * em POST cross-site) e o front usa Server Actions do Next, que já validam origem. Esta camada
 * cobre o dia em que o navegador falar direto com a API — e o custo dela é uma comparação.
 *
 * Rotas públicas ficam de fora porque não há sessão para proteger: forjar um POST de login
 * apenas loga a vítima na conta do atacante, e o fluxo do produto exige o segundo fator adiante.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || !request.auth) return true;

    const header = request.get(CSRF_HEADER) ?? undefined;
    if (!this.sessions.verifyCsrfToken(request.auth.session.id, header)) {
      throw new AppException('FORBIDDEN', {
        message: 'Requisição rejeitada por falha de verificação anti-CSRF.',
        logContext: { reason: 'csrf_token_invalido', path: request.path },
      });
    }

    return true;
  }
}
