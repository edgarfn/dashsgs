import { Controller, Get, Header, NotFoundException } from '@nestjs/common';
import { AppConfigService } from '../../config';
import { MetricsService } from './metrics.service';

/**
 * Endpoint de scrape do Prometheus. Fica FORA do prefixo `/api/v1` e, em produção, só é
 * alcançável pela rede interna — o Caddy não publica `/metrics` (doc 19 §2 e docker/Caddyfile).
 */
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async scrape(): Promise<string> {
    if (!this.config.metricsEnabled) throw new NotFoundException();
    return this.metrics.scrape();
  }
}
