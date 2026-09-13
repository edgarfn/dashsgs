import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config';
import { SgCircuitBreaker } from './http/sg-circuit-breaker';
import { SgHttpClient, SG_TRANSPORT, type SgTransport } from './http/sg-http.client';
import { SgRateLimiter } from './http/sg-rate-limiter';
import { SgMockTransport } from './mock/sg-mock.transport';
import { SgClient } from './sg.client';
import { SgTokenManager } from './sg-token.manager';

/** Transporte real: o `fetch` do Node, sem nenhuma mágica — a política toda vive no cliente. */
const transporteReal: SgTransport = {
  fetch: (url, init) => globalThis.fetch(url, init),
};

/**
 * Camada anticorrupção da API SG (doc 04 §2 / doc 12).
 *
 * O transporte é escolhido no boot: com `SG_MOCK=true` as fixtures respondem no lugar da rede,
 * o que permite desenvolver e rodar o CI sem um ERP à mão. Em produção a flag é proibida pelo
 * contrato de ambiente.
 */
@Module({
  providers: [
    SgCircuitBreaker,
    SgRateLimiter,
    SgMockTransport,
    {
      provide: SG_TRANSPORT,
      inject: [AppConfigService, SgMockTransport],
      useFactory: (config: AppConfigService, mock: SgMockTransport): SgTransport =>
        config.sg.mock ? mock : transporteReal,
    },
    SgHttpClient,
    SgTokenManager,
    SgClient,
  ],
  exports: [SgClient, SgTokenManager, SgCircuitBreaker],
})
export class SgModule {}
