import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import { CurrentAuth, Identity, RequirePermissions, RequireRecentMfa } from '../../common/auth';
import { AppException } from '../../common/errors/app.exception';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { erpConnectionSchema, type ErpConnectionInput } from './dto/erp-connection.dto';
import { ErpConnectionService, type ErpConnectionView } from './erp-connection.service';

/**
 * Conexão com o ERP do tenant (doc 23 §Tenancy).
 *
 * Gravar e testar exigem `erp_connection.manage` **e** MFA recente: é a credencial que dá acesso
 * a todos os dados do cliente no ERP (doc 16 §2). Ler o estado não exige MFA — a tela de
 * diagnóstico precisa abrir sem atrito, e ela não expõe segredo nenhum.
 */
@Controller('tenant/erp-connection')
export class ErpConnectionController {
  constructor(private readonly conexoes: ErpConnectionService) {}

  @Get()
  @RequirePermissions('erp_connection.manage')
  async obter(@CurrentAuth() auth: AuthContext): Promise<ErpConnectionView> {
    return this.conexoes.view(exigirTenant(auth));
  }

  @Put()
  @RequirePermissions('erp_connection.manage')
  @RequireRecentMfa()
  @HttpCode(200)
  async salvar(
    @Body(new ZodValidationPipe(erpConnectionSchema)) body: ErpConnectionInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<ErpConnectionView> {
    return this.conexoes.upsert(auth, exigirTenant(auth), body, identity);
  }

  @Post('test')
  @RequirePermissions('erp_connection.manage')
  @RequireRecentMfa()
  @HttpCode(200)
  async testar(@CurrentAuth() auth: AuthContext, @Identity() identity: RequestIdentity) {
    return this.conexoes.testar(auth, exigirTenant(auth), identity);
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
