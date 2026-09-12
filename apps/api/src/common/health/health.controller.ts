import type { LivenessBody, ReadinessBody } from '@dashsgs/shared';
import { Controller, Get, Header, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppConfigService } from '../../config';
import { HealthService } from './health.service';

/**
 * Health checks do doc 18 §3. Ficam fora do prefixo `/api/v1` e fora do log de acesso:
 *  - `/healthz` (liveness): o processo responde → usado para reiniciar container;
 *  - `/readyz` (readiness): dependências ok → usado pelo balanceador e pelo deploy (doc 19 §4).
 *
 * Nenhum dos dois exige autenticação (são a porta do orquestrador), por isso não revelam
 * nada além do estado das dependências — sem versões de biblioteca, sem hosts, sem DSN.
 */
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly config: AppConfigService,
  ) {}

  @Get('healthz')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  liveness(): LivenessBody {
    return {
      state: 'ok',
      version: this.config.version,
      uptimeSeconds: this.health.uptimeSeconds,
    };
  }

  @Get('readyz')
  @Header('Cache-Control', 'no-store')
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessBody> {
    const body = await this.health.readiness();
    // 503 quando não está pronto: contrato que o Caddy/compose e o smoke test entendem.
    res.status(body.state === 'ok' ? 200 : 503);
    return body;
  }
}
