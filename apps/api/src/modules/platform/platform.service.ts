import { Injectable } from '@nestjs/common';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import { AuditService } from '../../common/audit';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { InviteService } from '../auth/services/invite.service';

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  membros: number;
  convitesPendentes: number;
  createdAt: string;
  suspendedAt: string | null;
  suspensionReason: string | null;
}

/**
 * Operação da plataforma (runbooks 22 §1 e §2).
 *
 * Provisionar e suspender tenant é o mínimo para colocar um cliente no ar e para cortar o acesso
 * quando o contrato exige. Tudo aqui é auditado com o ator e o motivo — um tenant não some nem
 * volta sem rastro.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: InviteService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async listTenants(): Promise<TenantSummary[]> {
    const tenants = await this.prisma.tenant.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            memberships: true,
            invites: { where: { acceptedAt: null, revokedAt: null } },
          },
        },
      },
    });

    return tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      status: tenant.status,
      membros: tenant._count.memberships,
      convitesPendentes: tenant._count.invites,
      createdAt: tenant.createdAt.toISOString(),
      suspendedAt: tenant.suspendedAt?.toISOString() ?? null,
      suspensionReason: tenant.suspensionReason,
    }));
  }

  /**
   * Cria o tenant e já convida o owner — as duas coisas juntas, porque tenant sem dono é um
   * registro órfão que ninguém consegue administrar (runbook 22 §1, passo 1).
   */
  async createTenant(
    auth: AuthContext,
    input: { name: string; slug: string; plan: string; ownerEmail: string; ownerName?: string },
    identity: RequestIdentity,
  ): Promise<{ id: string; slug: string; inviteId: string }> {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw new AppException('CONFLICT', { message: 'Já existe um tenant com este slug.' });
    }

    const tenant = await this.prisma.tenant.create({
      data: { name: input.name, slug: input.slug, plan: input.plan },
    });

    const invite = await this.invites.create(
      auth,
      tenant.id,
      { email: input.ownerEmail, role: 'owner', filiaisAllowed: [], name: input.ownerName },
      identity,
    );

    await this.audit.record({
      action: 'platform.tenant_created',
      resourceType: 'tenant',
      resourceId: tenant.id,
      result: 'success',
      tenantId: tenant.id,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { slug: input.slug, plan: input.plan, ownerEmail: input.ownerEmail },
    });

    return { id: tenant.id, slug: tenant.slug, inviteId: invite.id };
  }

  /**
   * Suspende: bloqueia login dos membros e derruba as sessões abertas. Os dados ficam
   * intactos — suspensão não é offboarding (doc 08 §5).
   */
  async suspendTenant(
    auth: AuthContext,
    tenantId: string,
    reason: string,
    identity: RequestIdentity,
  ): Promise<void> {
    const tenant = await this.findTenant(tenantId);

    const membros = await this.prisma.membership.findMany({
      where: { tenantId: tenant.id },
      select: { userId: true },
    });
    const membrosIds = membros.map((membro) => membro.userId);

    await this.prisma.$transaction([
      this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'suspended', suspendedAt: new Date(), suspensionReason: reason },
      }),
      this.prisma.session.updateMany({
        where: {
          revokedAt: null,
          OR: [{ tenantId: tenant.id }, { userId: { in: membrosIds } }],
        },
        data: { revokedAt: new Date() },
      }),
    ]);

    // Cache do tenant sai junto: dado suspenso não continua servido de memória (doc 08 §4).
    await this.redis.purgeTenant(tenant.id);

    await this.audit.record({
      action: 'platform.tenant_suspended',
      resourceType: 'tenant',
      resourceId: tenant.id,
      result: 'success',
      tenantId: tenant.id,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { slug: tenant.slug, motivo: reason },
    });
  }

  /**
   * Offboarding (doc 08 §5): exclusão **lógica**. A purga física vem 30 dias depois, pelo job
   * de retenção — a carência existe para o cliente que se arrepende, para a exportação que o
   * contrato ainda permite pedir e para o erro de operação que só aparece no dia seguinte.
   *
   * Exige digitar o slug. É a diferença entre "cliquei sem querer" e "eu quis".
   */
  async offboardTenant(
    auth: AuthContext,
    tenantId: string,
    input: { reason: string; confirmarSlug: string },
    identity: RequestIdentity,
  ): Promise<{ purgaFisicaEm: string }> {
    const tenant = await this.findTenant(tenantId);

    if (input.confirmarSlug !== tenant.slug) {
      throw new AppException('VALIDATION_ERROR', {
        message: 'Digite o slug do tenant para confirmar o desligamento.',
        details: [{ path: 'confirmarSlug', rule: 'match' }],
      });
    }

    const membros = await this.prisma.membership.findMany({
      where: { tenantId: tenant.id },
      select: { userId: true },
    });
    const agora = new Date();

    await this.prisma.$transaction([
      this.prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          status: 'suspended',
          suspendedAt: agora,
          suspensionReason: input.reason,
          deletedAt: agora,
        },
      }),
      this.prisma.session.updateMany({
        where: {
          revokedAt: null,
          OR: [{ tenantId: tenant.id }, { userId: { in: membros.map((m) => m.userId) } }],
        },
        data: { revokedAt: agora },
      }),
    ]);

    await this.redis.purgeTenant(tenant.id);

    const purgaFisicaEm = new Date(agora.getTime() + 30 * 86_400_000);

    await this.audit.record({
      action: 'platform.tenant_offboarded',
      resourceType: 'tenant',
      resourceId: tenant.id,
      result: 'success',
      tenantId: tenant.id,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: {
        slug: tenant.slug,
        motivo: input.reason,
        purgaFisicaEm: purgaFisicaEm.toISOString(),
      },
    });

    return { purgaFisicaEm: purgaFisicaEm.toISOString() };
  }

  async resumeTenant(
    auth: AuthContext,
    tenantId: string,
    identity: RequestIdentity,
  ): Promise<void> {
    const tenant = await this.findTenant(tenantId);

    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { status: 'active', suspendedAt: null, suspensionReason: null },
    });

    await this.audit.record({
      action: 'platform.tenant_resumed',
      resourceType: 'tenant',
      resourceId: tenant.id,
      result: 'success',
      tenantId: tenant.id,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { slug: tenant.slug },
    });
  }

  private async findTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { id: true, slug: true, status: true },
    });
    if (!tenant) throw AppException.notFound({ tenantId });
    return tenant;
  }
}
