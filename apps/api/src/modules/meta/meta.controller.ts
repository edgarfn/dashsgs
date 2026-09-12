import { Controller, Get } from '@nestjs/common';
import { AppConfigService } from '../../config';

export interface MetaResponse {
  name: string;
  version: string;
  environment: string;
  features: { erpWrite: boolean; clientModule: boolean };
  serverTime: string;
}

/**
 * Metadados públicos da instalação — usado pelo front para selo de versão/ambiente e pelos
 * smoke tests do deploy (doc 19 §4). Não expõe nada sensível.
 */
@Controller('meta')
export class MetaController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  get(): MetaResponse {
    return {
      name: 'DashSGS',
      version: this.config.version,
      environment: this.config.nodeEnv,
      features: this.config.features,
      serverTime: new Date().toISOString(),
    };
  }
}
