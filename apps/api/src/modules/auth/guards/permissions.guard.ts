import { type Permission } from '@dashsgs/shared';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuditService } from '../../../common/audit';
import { AppException } from '../../../common/errors/app.exception';
import { REQUIRE_RECENT_MFA, REQUIRED_PERMISSIONS } from '../../../common/auth';
import { SessionService } from '../services/session.service';

/**
 * Guard central de autorização (doc 07 §1 e §4).
 *
 * RBAC decide *o que* pode ser feito; a RLS (doc 08) garante *de quem* são os dados. As duas
 * camadas existem porque um repositório que esqueça o filtro não pode virar vazamento.
 *
 * Toda negação relevante vira evento `authz.denied` na auditoria (doc 07 §4.4).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    const needsRecentMfa = this.reflector.getAllAndOverride<boolean>(REQUIRE_RECENT_MFA, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length && !needsRecentMfa) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.auth;
    if (!auth) throw new AppException('AUTH_REQUIRED');

    if (required?.length) {
      // Sem tenant ativo não há papel — logo, não há permissão de tenant nenhuma.
      const missing = required.filter((permission) => !auth.permissions.includes(permission));
      if (missing.length > 0) {
        await this.denied(request, missing.join(','), 'permissao_ausente');
        throw AppException.forbidden({ required, tenantId: auth.activeTenantId });
      }
    }

    if (needsRecentMfa && !this.sessions.isMfaRecent(auth.session.mfaVerifiedAt)) {
      await this.denied(request, request.path, 'mfa_nao_recente');
      throw new AppException('AUTH_MFA_REQUIRED', {
        message: 'Esta ação exige uma verificação recente em duas etapas.',
      });
    }

    return true;
  }

  private async denied(request: Request, resource: string, reason: string): Promise<void> {
    const auth = request.auth;
    await this.audit.record({
      action: 'authz.denied',
      resourceType: 'endpoint',
      resourceId: `${request.method} ${request.route?.path ?? request.path}`,
      result: 'denied',
      tenantId: auth?.activeTenantId ?? null,
      userId: auth?.user.id ?? null,
      sessionId: auth?.session.id ?? null,
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
      changes: { reason, resource },
    });
  }
}
