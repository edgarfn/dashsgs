import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentAuth, Identity, RequirePermissions } from '../../common/auth';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import { AppException } from '../../common/errors/app.exception';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AlertEngine, type ResultadoAvaliacao } from './alert-engine.service';
import { AlertFeedService, type EventoView, type FeedView } from './alert-feed.service';
import { AlertRulesService, type RegraView } from './alert-rules.service';
import {
  feedQuerySchema,
  regraUpdateSchema,
  type FeedQuery,
  type RegraUpdateInput,
} from './dto/alertas.dto';

/**
 * Alertas do tenant (doc 16 §2, telas "Alertas — Feed" e "Alertas — Regras").
 *
 * Duas permissões diferentes, de propósito: qualquer pessoa que opera a loja **reconhece** um
 * alerta (`alerts.ack`); mudar limiar e desligar aviso é decisão de quem administra o produto
 * (`alerts.manage`). Desligar um alerta crítico não pode ser um clique de plantão.
 */
@Controller('alertas')
export class AlertasController {
  constructor(
    private readonly feed: AlertFeedService,
    private readonly regras: AlertRulesService,
    private readonly engine: AlertEngine,
  ) {}

  @Get()
  @RequirePermissions('alerts.ack')
  async listar(
    @Query(new ZodValidationPipe(feedQuerySchema)) query: FeedQuery,
    @CurrentAuth() auth: AuthContext,
  ): Promise<FeedView> {
    return this.feed.listar(exigirTenant(auth), query);
  }

  @Post(':id/reconhecer')
  @RequirePermissions('alerts.ack')
  @HttpCode(200)
  async reconhecer(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<EventoView> {
    return this.feed.reconhecer(auth, exigirTenant(auth), id, identity);
  }

  @Get('regras')
  @RequirePermissions('alerts.manage')
  async listarRegras(@CurrentAuth() auth: AuthContext): Promise<RegraView[]> {
    return this.regras.listar(exigirTenant(auth));
  }

  @Patch('regras/:id')
  @RequirePermissions('alerts.manage')
  async atualizarRegra(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(regraUpdateSchema)) body: RegraUpdateInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<RegraView> {
    return this.regras.atualizar(exigirTenant(auth), id, body);
  }

  /**
   * Avalia as regras agora, sem esperar o ciclo.
   *
   * Existe para o admin que acabou de ajustar um limiar e quer ver o efeito — e para o suporte,
   * que precisa reproduzir o que o cliente está vendo. Roda no processo da API porque a avaliação
   * é rápida (consulta ao espelho, sem ERP no caminho).
   */
  @Post('avaliar')
  @RequirePermissions('alerts.manage')
  @HttpCode(200)
  async avaliarAgora(@CurrentAuth() auth: AuthContext): Promise<ResultadoAvaliacao> {
    return this.engine.avaliar(exigirTenant(auth));
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
