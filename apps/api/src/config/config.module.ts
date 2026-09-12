import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';
import { loadEnvOrExit, type Env } from './env.schema';

export const ENV = Symbol('DASHSGS_ENV');

/**
 * Modulo global de configuracao: valida o ambiente uma unica vez, no boot.
 * Falha de validacao encerra o processo antes de qualquer porta ser aberta (E1-04).
 */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => loadEnvOrExit() },
    {
      provide: AppConfigService,
      useFactory: (env: Env) => new AppConfigService(env),
      inject: [ENV],
    },
  ],
  exports: [AppConfigService, ENV],
})
export class ConfigModule {}
