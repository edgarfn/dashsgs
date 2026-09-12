import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth, Identity } from '../../common/auth';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformService, type TenantSummary } from './platform.service';

const tenantCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    /** Slug entra em URL e em chave de cache: alfabeto restrito, sem surpresa. */
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'use letras minúsculas, números e hífen'),
    plan: z.string().trim().min(2).max(40).default('beta'),
    ownerEmail: z.string().trim().toLowerCase().email().max(255),
    ownerName: z.string().trim().min(2).max(120).optional(),
  })
  .strict();
type TenantCreateInput = z.infer<typeof tenantCreateSchema>;

const suspendSchema = z.object({ reason: z.string().trim().min(5).max(200) }).strict();
type SuspendInput = z.infer<typeof suspendSchema>;

/**
 * Painel da plataforma (E3-07) — torna executáveis os runbooks 22 §1 e §2.
 *
 * Fica fora de `/tenant` de propósito: são contas separadas, com papel global e MFA recente
 * exigido pelo guard (doc 07 §2).
 */
@Controller('platform')
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('tenants')
  async listTenants(): Promise<TenantSummary[]> {
    return this.platform.listTenants();
  }

  @Post('tenants')
  @HttpCode(201)
  async createTenant(
    @Body(new ZodValidationPipe(tenantCreateSchema)) body: TenantCreateInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<{ id: string; slug: string; inviteId: string }> {
    return this.platform.createTenant(auth, body, identity);
  }

  @Post('tenants/:id/suspend')
  @HttpCode(204)
  async suspend(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(suspendSchema)) body: SuspendInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<void> {
    await this.platform.suspendTenant(auth, id, body.reason, identity);
  }

  @Post('tenants/:id/resume')
  @HttpCode(204)
  async resume(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<void> {
    await this.platform.resumeTenant(auth, id, identity);
  }
}
