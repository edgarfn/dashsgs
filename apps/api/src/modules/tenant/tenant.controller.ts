import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { AUDIT_RESULTADO_LABEL, type AuditEntryView, type Paginated } from '@dashsgs/shared';
import type { Response } from 'express';
import { AppException } from '../../common/errors/app.exception';
import { CurrentAuth, Identity, RequirePermissions } from '../../common/auth';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import { AuditService } from '../../common/audit';
import { gerarCsv, nomeDeArquivo } from '../../common/csv';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseFiliaisParam } from '../../common/tenant';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { InviteService } from '../auth/services/invite.service';
import { inviteCreateSchema, type InviteCreateInput } from '../auth/dto/auth.dto';
import {
  auditExportQuerySchema,
  auditQuerySchema,
  filiaisQuerySchema,
  memberUpdateSchema,
  type AuditExportQueryInput,
  type AuditQueryInput,
  type FiliaisQueryInput,
  type MemberUpdateInput,
} from './dto/tenant.dto';
import { AuditoriaService } from './auditoria.service';
import { FiliaisService, type FilialView } from './filiais.service';
import { MembersService, type MemberView } from './members.service';

/** Dados e administração do tenant corrente (doc 23 §Tenancy). */
@Controller('tenant')
export class TenantController {
  constructor(
    private readonly members: MembersService,
    private readonly invites: InviteService,
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly audit: AuditService,
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

  // ------------------------------------------------------------------ auditoria (E6-01)

  /**
   * Trilha de auditoria do tenant (doc 16 §2 / doc 23 §Tenancy).
   *
   * `audit.view` é permissão separada de `users.manage` de propósito: o papel `auditor` existe
   * justamente para quem lê a trilha sem administrar nada (doc 07 §1).
   */
  @Get('audit')
  @RequirePermissions('audit.view')
  async listAudit(
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQueryInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Paginated<AuditEntryView>> {
    return this.auditoria.listar(requireTenant(auth), query);
  }

  /** Ações que existem na trilha deste tenant — o filtro não oferece o que nunca aconteceu. */
  @Get('audit/acoes')
  @RequirePermissions('audit.view')
  async listAuditActions(@CurrentAuth() auth: AuthContext): Promise<string[]> {
    return this.auditoria.acoesDisponiveis(requireTenant(auth));
  }

  /**
   * Export da trilha em CSV.
   *
   * **O export é auditado.** Levar a trilha para fora é o momento em que ela deixa o nosso
   * controle (doc 10 §3): quem exportou, quando e com que filtro fica registrado na própria
   * trilha — inclusive quando o arquivo sai truncado pelo teto.
   */
  @Get('audit/export')
  @RequirePermissions('audit.view')
  @Header('Cache-Control', 'no-store')
  async exportAudit(
    @Query(new ZodValidationPipe(auditExportQuerySchema)) query: AuditExportQueryInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
    @Res() res: Response,
  ): Promise<void> {
    const tenantId = requireTenant(auth);
    const { linhas, truncado } = await this.auditoria.exportar(tenantId, query);

    await this.audit.record({
      action: 'audit.exported',
      resourceType: 'audit_log',
      result: 'success',
      tenantId,
      userId: auth.user.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { filtros: query, linhas: linhas.length, truncado },
    });

    const csv = gerarCsv<AuditEntryView>(
      [
        { cabecalho: 'Quando', valor: (linha) => linha.createdAt },
        { cabecalho: 'Ação', valor: (linha) => linha.acaoLabel },
        { cabecalho: 'Código', valor: (linha) => linha.acao },
        { cabecalho: 'Resultado', valor: (linha) => AUDIT_RESULTADO_LABEL[linha.resultado] },
        { cabecalho: 'Pessoa', valor: (linha) => linha.ator?.nome ?? '—' },
        { cabecalho: 'E-mail', valor: (linha) => linha.ator?.email ?? '—' },
        { cabecalho: 'Recurso', valor: (linha) => linha.recursoTipo },
        { cabecalho: 'Id do recurso', valor: (linha) => linha.recursoId },
        { cabecalho: 'IP', valor: (linha) => linha.ip },
        // O JSON inteiro numa coluna: é feio numa planilha e é exatamente o que um auditor
        // precisa quando pergunta "o que mudou nesta linha?".
        { cabecalho: 'Detalhes', valor: (linha) => JSON.stringify(linha.changes ?? {}) },
      ],
      linhas,
    );

    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${nomeDeArquivo('auditoria', query.ate ?? new Date().toISOString().slice(0, 10))}"`,
      )
      .send(csv);
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
