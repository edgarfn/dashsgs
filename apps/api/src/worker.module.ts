import { Module } from '@nestjs/common';
import { AuditModule } from './common/audit';
import { CryptoModule } from './common/crypto';
import { ErrorsModule } from './common/errors/errors.module';
import { LoggerModule } from './common/logging/logger.module';
import { MailModule } from './common/mail';
import { MetricsModule } from './common/metrics/metrics.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { TenantContextModule } from './common/tenant';
import { ConfigModule } from './config';
import { SyncWorker } from './modules/sync/queue/sync.worker';
import { SyncModule } from './modules/sync/sync.module';

/**
 * Processo de worker (doc 04 §2): a mesma aplicação, sem servidor HTTP.
 *
 * Só entra aqui o que um job precisa — banco, Redis, cripto (para abrir o cofre da credencial),
 * métricas e a sincronização. Nada de guards, controllers ou rate limit de request: worker não
 * atende ninguém, e importar a superfície HTTP só aumentaria o que pode quebrar.
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    ErrorsModule,
    PrismaModule,
    RedisModule,
    CryptoModule,
    TenantContextModule,
    MailModule,
    AuditModule,
    MetricsModule,
    SyncModule,
  ],
  providers: [SyncWorker],
})
export class WorkerModule {}
