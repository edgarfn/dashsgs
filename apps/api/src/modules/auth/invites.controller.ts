import { type InvitePreview } from '@dashsgs/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import { CurrentAuth, Identity, Public, RequirePermissions } from '../../common/auth';
import {
  inviteAcceptSchema,
  inviteCreateSchema,
  type InviteAcceptInput,
  type InviteCreateInput,
} from './dto/auth.dto';
import { InviteService } from './services/invite.service';

const tokenQuerySchema = z.object({ token: z.string().trim().min(20).max(200) }).strict();

/**
 * Fluxo público do convite: quem recebe o e-mail ainda não tem sessão.
 * O token é o único segredo — por isso o rate limit por IP no serviço (varredura de tokens).
 */
@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InviteService) {}

  @Get('preview')
  @Public()
  async preview(
    @Query(new ZodValidationPipe(tokenQuerySchema)) query: { token: string },
    @Identity() identity: RequestIdentity,
  ): Promise<InvitePreview> {
    return this.invites.preview(query.token, identity);
  }

  @Post('accept')
  @Public()
  @HttpCode(200)
  async accept(
    @Body(new ZodValidationPipe(inviteAcceptSchema)) body: InviteAcceptInput,
    @Identity() identity: RequestIdentity,
  ): Promise<{ email: string }> {
    const result = await this.invites.accept(body, identity);
    // Não cria sessão automaticamente: a pessoa passa pelo login (e pelo MFA, se o papel exigir).
    return { email: result.email };
  }
}

/** Gestão de convites e membros do tenant corrente (doc 23 §Tenancy). */
@Controller('tenant')
export class TenantMembersController {
  constructor(
    private readonly invites: InviteService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('users')
  @RequirePermissions('users.manage')
  async listUsers(@CurrentAuth() auth: AuthContext) {
    const tenantId = requireTenant(auth);
    const memberships = await this.prisma.membership.findMany({
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
    });

    return memberships.map((membership) => ({
      membershipId: membership.id,
      role: membership.role,
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

  @Get('invites')
  @RequirePermissions('users.manage')
  async listInvites(@CurrentAuth() auth: AuthContext) {
    const tenantId = requireTenant(auth);
    const invites = await this.invites.listPending(tenantId);
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

    // Ninguém convida para um papel acima do seu: admin não fabrica owner (escalada de privilégio).
    if (
      body.role === 'owner' &&
      !auth.memberships.some((m) => m.tenantId === tenantId && m.role === 'owner')
    ) {
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
