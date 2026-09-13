import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import {
  CurrentAuth,
  Identity,
  RequirePermissions,
  type AuthContext,
  type RequestIdentity,
} from '../../common/auth';
import { AuditService } from '../../common/audit';
import { AppException } from '../../common/errors/app.exception';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { BackfillService, type ProgressoBackfill } from './backfill.service';
import { backfillSchema, resyncSchema, type BackfillInput, type ResyncInput } from './dto/sync.dto';
import { SyncQueueService } from './queue/sync-queue.service';
import { SyncStatusService, type PainelSync } from './sync-status.service';

/**
 * Painel de sincronização do tenant (E5-12 / doc 26 §Status).
 *
 * Ler e agir exigem `erp_connection.manage`: é a mesma pessoa que configura a integração. Não
 * exigimos MFA recente aqui — nada nesta tela expõe credencial, e pedir segundo fator para
 * consultar frescor de dado só ensinaria o admin a digitar código por reflexo.
 *
 * Nenhuma rota executa sync no processo da API: tudo vai para a fila. Um clique não pode segurar
 * um request HTTP por minutos, nem competir com o dashboard por CPU.
 */
@Controller('tenant/sync')
export class SyncController {
  constructor(
    private readonly status: SyncStatusService,
    private readonly backfill: BackfillService,
    private readonly filas: SyncQueueService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('erp_connection.manage')
  async painel(@CurrentAuth() auth: AuthContext): Promise<PainelSync> {
    return this.status.painel(exigirTenant(auth));
  }

  @Post('resync')
  @RequirePermissions('erp_connection.manage')
  @HttpCode(202)
  async ressincronizar(
    @Body(new ZodValidationPipe(resyncSchema)) body: ResyncInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<{ enfileirado: true }> {
    const tenantId = exigirTenant(auth);

    await this.filas.enfileirar({
      tipo: 'dominio',
      tenantId,
      domain: body.domain,
      filialErpId: body.filialErpId,
      data: body.data,
    });

    await this.audit.record({
      action: 'sync.resync_requested',
      resourceType: 'sync',
      resourceId: body.domain,
      result: 'success',
      tenantId,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { domain: body.domain, filial: body.filialErpId ?? null, data: body.data ?? null },
    });

    return { enfileirado: true };
  }

  @Post('backfill')
  @RequirePermissions('erp_connection.manage')
  @HttpCode(202)
  async iniciarBackfill(
    @Body(new ZodValidationPipe(backfillSchema)) body: BackfillInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<ProgressoBackfill> {
    const tenantId = exigirTenant(auth);

    const plano = await this.backfill.iniciar(tenantId, {
      dias: body.dias,
      filiais: body.filiais,
    });
    await this.filas.enfileirarBackfill(tenantId);

    await this.audit.record({
      action: 'sync.backfill_started',
      resourceType: 'sync',
      resourceId: 'backfill',
      result: 'success',
      tenantId,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { dias: body.dias, filiais: plano.filiais.length },
    });

    return this.backfill.progresso(tenantId);
  }

  @Delete('backfill')
  @RequirePermissions('erp_connection.manage')
  @HttpCode(200)
  async cancelarBackfill(
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<ProgressoBackfill> {
    const tenantId = exigirTenant(auth);
    await this.backfill.cancelar(tenantId);

    await this.audit.record({
      action: 'sync.backfill_cancelled',
      resourceType: 'sync',
      resourceId: 'backfill',
      result: 'success',
      tenantId,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
    });

    return this.backfill.progresso(tenantId);
  }
}

function exigirTenant(auth: AuthContext): string {
  if (!auth.activeTenantId) {
    throw new AppException('VALIDATION_ERROR', {
      message: 'Selecione um tenant antes de continuar.',
      details: [{ path: 'tenant', rule: 'required' }],
    });
  }
  return auth.activeTenantId;
}
