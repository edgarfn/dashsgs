import { type InvitePreview } from '@dashsgs/shared';
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type RequestIdentity } from '../../common/auth';
import { Identity, Public } from '../../common/auth';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { inviteAcceptSchema, type InviteAcceptInput } from './dto/auth.dto';
import { InviteService } from './services/invite.service';

const tokenQuerySchema = z.object({ token: z.string().trim().min(20).max(200) }).strict();

/**
 * Fluxo público do convite: quem recebe o e-mail ainda não tem sessão.
 * O token é o único segredo — por isso o rate limit por IP no serviço (varredura de tokens).
 *
 * O lado administrativo (criar, listar e revogar convites) vive no módulo de tenant, junto da
 * gestão de membros: lá é administração de acesso, aqui é identidade.
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
