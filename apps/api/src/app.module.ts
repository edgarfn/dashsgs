import { Module } from '@nestjs/common';
import { ErrorsModule } from './common/errors/errors.module';
import { HealthModule } from './common/health/health.module';
import { LoggerModule } from './common/logging/logger.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { ConfigModule } from './config';
import { MetaModule } from './modules/meta/meta.module';

/**
 * Monolito modular (ADR-001): plataforma transversal primeiro, módulos de produto depois.
 * A ordem dos imports importa — config valida o ambiente antes de qualquer conexao.
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    ErrorsModule,
    PrismaModule,
    RedisModule,
    MetricsModule,
    HealthModule,
    MetaModule,
  ],
})
export class AppModule {}
