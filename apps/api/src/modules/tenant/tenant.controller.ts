import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { CurrentAuth, Identity, RequirePermissions } from '../../common/auth';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseFiliaisParam } from '../../common/tenant';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { InviteService } from '../auth/services/invite.service';
import { inviteCreateSchema, type InviteCreateInput } from '../auth/dto/auth.dto';
import {
  filiaisQuerySchema,
  memberUpdateSchema,
  type FiliaisQueryInput,
  type MemberUpdateInput,
} from './dto/tenant.dto';
import { FiliaisService, type FilialView } from './filiais.service';
import { MembersService, type MemberView } from './members.service';

/** Dados e administração do tenant corrente (doc 23 §Tenancy). */
@Controller('tenant')
export class TenantController {
  constructor(
    private readonly members: MembersService,
    private readonly invites: InviteService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async current(@CurrentAuth() auth: AuthContext) {
    const tenantId = requireTenant(auth);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, plan: true, status: true, timezone: true },
    });
    const membership = auth.memberships.find((item) => item.tenantId === tenantId);

    return {
      ...tenant,
      role: membership?.role,
      filiaisAllowed: membership?.filiaisAllowed ?? [],
      permissions: auth.permissions,
    };
  }

  @Get('users')
  @RequirePermissions('users.manage')
  async listUsers(@CurrentAuth() auth: AuthContext): Promise<MemberView[]> {
    return this.members.list(requireTenant(auth));
  }

  @Patch('users/:membershipId')
  @RequirePermissions('users.manage')
  @HttpCode(200)
  async updateUser(
    @Param('membershipId') membershipId: string,
    @Body(new ZodValidationPipe(memberUpdateSchema)) body: MemberUpdateInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<MemberView> {
    return this.members.update(auth, requireTenant(auth), membershipId, body, identity);
  }

  @Delete('users/:membershipId')
  @RequirePermissions('users.manage')
  @HttpCode(204)
  async removeUser(
    @Param('membershipId') membershipId: string,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<void> {
    await this.members.remove(auth, requireTenant(auth), membershipId, identity);
  }

  @Get('invites')
  @RequirePermissions('users.manage')
  async listInvites(@CurrentAuth() auth: AuthContext) {
    const invites = await this.invites.listPending(requireTenant(auth));
    return invites.map((invite) => ({
      ...invite,
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
    }));
  }

  @Post('invites')
  @RequirePermissions('users.manage')
  @HttpCode(201)
  async createInvite(
    @Body(new ZodValidationPipe(inviteCreateSchema)) body: InviteCreateInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<{ id: string; expiresAt: string }> {
    const tenantId = requireTenant(auth);

    // Ninguém convida para um papel acima do seu: admin não fabrica owner (escalada).
    const isOwner = auth.memberships.some(
      (membership) => membership.tenantId === tenantId && membership.role === 'owner',
    );
    if (body.role === 'owner' && !isOwner) {
      throw AppException.forbidden({ reason: 'somente owner convida owner' });
    }

    const invite = await this.invites.create(auth, tenantId, body, identity);
    return { id: invite.id, expiresAt: invite.expiresAt.toISOString() };
  }

  @Delete('invites/:id')
  @RequirePermissions('users.manage')
  @HttpCode(204)
  async revokeInvite(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<void> {
    await this.invites.revoke(auth, requireTenant(auth), id, identity);
  }
}

/** Dimensões para filtros da UI (doc 23 §`GET /dim/...`). */
@Controller('dim')
export class DimController {
  constructor(private readonly filiais: FiliaisService) {}

  @Get('filiais')
  @RequirePermissions('dashboard.view')
  async listFiliais(
    @Query(new ZodValidationPipe(filiaisQuerySchema)) query: FiliaisQueryInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<FilialView[]> {
    return this.filiais.list(auth, requireTenant(auth), parseFiliaisParam(query.filiais));
  }
}

/** Sem tenant ativo não há papel — e sem papel não há permissão de tenant (doc 07 §1). */
function requireTenant(auth: AuthContext): string {
  if (!auth.activeTenantId) {
    throw new AppException('VALIDATION_ERROR', {
      message: 'Selecione um tenant antes de continuar.',
      details: [{ path: 'tenant', rule: 'required' }],
    });
  }
  return auth.activeTenantId;
}
