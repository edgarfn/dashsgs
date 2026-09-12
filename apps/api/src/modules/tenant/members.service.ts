import { type Role } from '@dashsgs/shared';
import { Injectable } from '@nestjs/common';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import { AuditService } from '../../common/audit';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDatabase } from '../../common/tenant';

export interface MemberView {
  membershipId: string;
  role: Role;
  filiaisAllowed: number[];
  memberSince: string;
  user: {
    id: string;
    name: string;
    email: string;
    status: string;
    mfaEnabled: boolean;
    lastLoginAt: string | null;
  };
}

/**
 * Gestão de membros do tenant (doc 07 §2 e doc 16 §2 "Admin — Usuários").
 *
 * As regras duras daqui existem para impedir que a administração se corte sozinha ou que alguém
 * suba de papel: ninguém altera o próprio vínculo, só owner mexe em owner, e o último owner não
 * pode ser removido nem rebaixado.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<MemberView[]> {
    // Leitura de dado de tenant: passa pelo contexto que ativa a RLS (doc 08 §3).
    const memberships = await this.tenantDb.run(tenantId, (tx) =>
      tx.membership.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          filiaisAllowed: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              status: true,
              totpEnabled: true,
              lastLoginAt: true,
            },
          },
        },
      }),
    );

    return memberships.map((membership) => ({
      membershipId: membership.id,
      role: membership.role as Role,
      filiaisAllowed: membership.filiaisAllowed,
      memberSince: membership.createdAt.toISOString(),
      user: {
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        status: membership.user.status,
        mfaEnabled: membership.user.totpEnabled,
        lastLoginAt: membership.user.lastLoginAt?.toISOString() ?? null,
      },
    }));
  }

  async update(
    auth: AuthContext,
    tenantId: string,
    membershipId: string,
    changes: { role?: Role; filiaisAllowed?: number[] },
    identity: RequestIdentity,
  ): Promise<MemberView> {
    const membership = await this.findInTenant(tenantId, membershipId);
    this.assertNotSelf(auth, membership.userId, 'alterar o próprio vínculo');

    if (changes.role && changes.role !== membership.role) {
      this.assertOwnerChangesOwner(auth, tenantId, [membership.role as Role, changes.role]);
      if (membership.role === 'owner') await this.assertNotLastOwner(tenantId, membershipId);
    }

    const updated = await this.tenantDb.run(
      tenantId,
      (tx) =>
        tx.membership.update({
          where: { id: membershipId },
          data: {
            ...(changes.role ? { role: changes.role } : {}),
            ...(changes.filiaisAllowed ? { filiaisAllowed: changes.filiaisAllowed } : {}),
          },
          select: {
            id: true,
            role: true,
            filiaisAllowed: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                status: true,
                totpEnabled: true,
                lastLoginAt: true,
              },
            },
          },
        }),
      { userId: auth.user.id },
    );

    await this.audit.record({
      action: 'tenant.member_updated',
      resourceType: 'membership',
      resourceId: membershipId,
      result: 'success',
      tenantId,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: {
        alvo: membership.userId,
        de: { role: membership.role, filiaisAllowed: membership.filiaisAllowed },
        para: { role: updated.role, filiaisAllowed: updated.filiaisAllowed },
      },
    });

    return {
      membershipId: updated.id,
      role: updated.role as Role,
      filiaisAllowed: updated.filiaisAllowed,
      memberSince: updated.createdAt.toISOString(),
      user: {
        id: updated.user.id,
        name: updated.user.name,
        email: updated.user.email,
        status: updated.user.status,
        mfaEnabled: updated.user.totpEnabled,
        lastLoginAt: updated.user.lastLoginAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * Remove o vínculo (a conta continua existindo — ela pode pertencer a outros tenants) e
   * derruba as sessões que estavam com este tenant ativo.
   */
  async remove(
    auth: AuthContext,
    tenantId: string,
    membershipId: string,
    identity: RequestIdentity,
  ): Promise<void> {
    const membership = await this.findInTenant(tenantId, membershipId);
    this.assertNotSelf(auth, membership.userId, 'remover o próprio vínculo');

    if (membership.role === 'owner') {
      this.assertOwnerChangesOwner(auth, tenantId, ['owner']);
      await this.assertNotLastOwner(tenantId, membershipId);
    }

    await this.tenantDb.run(
      tenantId,
      async (tx) => {
        await tx.membership.delete({ where: { id: membershipId } });
        await tx.session.updateMany({
          where: { userId: membership.userId, tenantId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      },
      { userId: auth.user.id },
    );

    await this.audit.record({
      action: 'tenant.member_removed',
      resourceType: 'membership',
      resourceId: membershipId,
      result: 'success',
      tenantId,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { alvo: membership.userId, role: membership.role },
    });
  }

  private async findInTenant(tenantId: string, membershipId: string) {
    const membership = await this.tenantDb.run(tenantId, (tx) =>
      tx.membership.findFirst({
        where: { id: membershipId, tenantId },
        select: { id: true, userId: true, role: true, filiaisAllowed: true },
      }),
    );
    // Vínculo de outro tenant não é "proibido", é inexistente daqui (doc 08 §4).
    if (!membership) throw AppException.notFound({ membershipId, tenantId });
    return membership;
  }

  private assertNotSelf(auth: AuthContext, targetUserId: string, acao: string): void {
    if (auth.user.id === targetUserId) {
      throw new AppException('CONFLICT', {
        message: `Você não pode ${acao}. Peça a outro administrador.`,
        logContext: { reason: 'auto_alteracao_bloqueada' },
      });
    }
  }

  /** Papel de owner só é concedido ou retirado por quem já é owner (doc 07 §4). */
  private assertOwnerChangesOwner(auth: AuthContext, tenantId: string, roles: Role[]): void {
    if (!roles.includes('owner')) return;

    const isOwner = auth.memberships.some(
      (membership) => membership.tenantId === tenantId && membership.role === 'owner',
    );
    if (!isOwner) {
      throw AppException.forbidden({ reason: 'somente owner gerencia owner', tenantId });
    }
  }

  private async assertNotLastOwner(tenantId: string, membershipId: string): Promise<void> {
    const owners = await this.prisma.membership.count({
      where: { tenantId, role: 'owner', id: { not: membershipId } },
    });
    if (owners === 0) {
      throw new AppException('CONFLICT', {
        message: 'O tenant precisa de pelo menos um owner. Promova outra pessoa antes.',
        logContext: { reason: 'ultimo_owner' },
      });
    }
  }
}
