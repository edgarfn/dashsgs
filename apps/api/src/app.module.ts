import { Module } from '@nestjs/common';
import { AuditModule } from './common/audit';
import { CryptoModule } from './common/crypto';
import { ErrorsModule } from './common/errors/errors.module';
import { MailModule } from './common/mail';
import { RateLimitModule } from './common/rate-limit';
import { TenantContextModule } from './common/tenant';
import { HealthModule } from './common/health/health.module';
import { LoggerModule } from './common/logging/logger.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { ConfigModule } from './config';
import { AuthModule } from './modules/auth/auth.module';
import { ErpConnectionModule } from './modules/erp-connection/erp-connection.module';
import { MetaModule } from './modules/meta/meta.module';
import { PlatformModule } from './modules/platform/platform.module';
import { TenantModule } from './modules/tenant/tenant.module';

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
    CryptoModule,
    RateLimitModule,
    TenantContextModule,
    MailModule,
    AuditModule,
    MetricsModule,
    HealthModule,
    MetaModule,
    AuthModule,
    TenantModule,
    PlatformModule,
    ErpConnectionModule,
  ],
})
export class AppModule {}
