import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth, Identity } from '../../common/auth';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import {
  BreakGlassService,
  type ConcessaoView,
  type RelatorioBreakGlass,
} from './break-glass.service';
import { PlatformAdminGuard } from './platform-admin.guard';

/**
 * O pedido carrega o chamado e o motivo porque é isso que a aprovação vai julgar — e é isso que
 * o owner do tenant vai ler no e-mail. Justificativa curta demais não explica nada a ninguém.
 */
const solicitacaoSchema = z
  .object({
    tenantId: z.string().uuid(),
    ticket: z.string().trim().min(2).max(60),
    justificativa: z.string().trim().min(20).max(300),
    papel: z.enum(['viewer', 'analyst', 'manager']).default('viewer'),
    minutos: z.number().int().min(15).max(480).default(120),
  })
  .strict();
type SolicitacaoInput = z.infer<typeof solicitacaoSchema>;

/**
 * Break-glass (E9-03) — runbook 22 §11 executável.
 *
 * O runbook pedia um comando de CLI; virou rota, porque a aprovação de segunda pessoa precisa de
 * alguém autenticado do outro lado, com MFA recente — e isso um binário na máquina do operador
 * não garante.
 */
@Controller('platform/break-glass')
@UseGuards(PlatformAdminGuard)
export class BreakGlassController {
  constructor(private readonly breakGlass: BreakGlassService) {}

  @Get()
  async listar(): Promise<ConcessaoView[]> {
    return this.breakGlass.listar();
  }

  @Get(':id/relatorio')
  async relatorio(@Param('id') id: string): Promise<RelatorioBreakGlass> {
    return this.breakGlass.relatorio(id);
  }

  @Post()
  @HttpCode(201)
  async solicitar(
    @Body(new ZodValidationPipe(solicitacaoSchema)) body: SolicitacaoInput,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<ConcessaoView> {
    return this.breakGlass.solicitar(auth, body, identity);
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  async aprovar(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<ConcessaoView> {
    return this.breakGlass.aprovar(auth, id, identity);
  }

  @Post(':id/revogar')
  @HttpCode(200)
  async revogar(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Identity() identity: RequestIdentity,
  ): Promise<ConcessaoView> {
    return this.breakGlass.revogar(auth, id, identity);
  }
}
