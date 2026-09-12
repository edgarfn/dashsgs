import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../../common/audit';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SessionService } from '../auth/services/session.service';

/**
 * Acesso à administração da plataforma (doc 07 §2 e §4.5).
 *
 * Três exigências, todas necessárias:
 *  - a conta tem a marca `platform_admin` (papel global, fora de membership);
 *  - a sessão passou por MFA recente — operar a plataforma é ação sensível;
 *  - o resultado é auditado, inclusive a negação.
 *
 * O que este guard **não** dá: acesso a dados de negócio dos tenants. Isso é break-glass
 * (runbook 22 §11), com justificativa, prazo e notificação ao owner — Fase 9.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.auth;
    if (!auth) throw new AppException('AUTH_REQUIRED');

    const user = await this.prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { platformAdmin: true },
    });

    if (!user?.platformAdmin) {
      await this.deny(request, 'nao_e_platform_admin');
      // 404 e não 403: a existência do painel não é assunto de quem não opera a plataforma.
      throw AppException.notFound({ area: 'platform' });
    }

    if (!this.sessions.isMfaRecent(auth.session.mfaVerifiedAt)) {
      await this.deny(request, 'mfa_nao_recente');
      throw new AppException('AUTH_MFA_REQUIRED', {
        message: 'Esta área exige uma verificação recente em duas etapas.',
      });
    }

    return true;
  }

  private async deny(request: Request, reason: string): Promise<void> {
    await this.audit.record({
      action: 'authz.denied',
      resourceType: 'platform',
      resourceId: `${request.method} ${request.route?.path ?? request.path}`,
      result: 'denied',
      userId: request.auth?.user.id ?? null,
      sessionId: request.auth?.session.id ?? null,
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
      changes: { reason },
    });
  }
}
