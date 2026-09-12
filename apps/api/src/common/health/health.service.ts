import type { DependencyHealth, HealthState, ReadinessBody } from '@dashsgs/shared';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Acima do tempo normal de resposta (ms) e bem abaixo do intervalo de probe (30 s):
// readiness lenta e readiness mentirosa custam o mesmo — um deploy parado.
const TIMEOUT_MS = 3_000;

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout em ${label}`)), TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Readiness real (doc 18 §3): Postgres, Redis e estado das migrações.
 * Um processo que não consegue servir dados corretos não deve receber tráfego — e o deploy
 * (doc 19 §4) usa exatamente este endpoint como portão.
 */
@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  get uptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  async readiness(): Promise<ReadinessBody> {
    const checks = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkMigrations(),
    ]);
    return {
      state: aggregate(checks),
      version: this.config.version,
      uptimeSeconds: this.uptimeSeconds,
      checks,
    };
  }

  private async checkPostgres(): Promise<DependencyHealth> {
    const startedAt = Date.now();
    try {
      await withTimeout(this.prisma.ping(), 'postgres');
      return { name: 'postgres', state: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { name: 'postgres', state: 'down', detail: safeDetail(error) };
    }
  }

  private async checkRedis(): Promise<DependencyHealth> {
    const startedAt = Date.now();
    try {
      await withTimeout(this.redis.ping(), 'redis');
      return { name: 'redis', state: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { name: 'redis', state: 'down', detail: safeDetail(error) };
    }
  }

  private async checkMigrations(): Promise<DependencyHealth> {
    try {
      const { applied, pending, failed } = await withTimeout(
        this.prisma.migrationsHealth(),
        'migrations',
      );
      if (failed > 0) {
        return {
          name: 'migrations',
          state: 'down',
          detail: `${failed} migração(ões) revertida(s)`,
        };
      }
      if (pending > 0) {
        return { name: 'migrations', state: 'degraded', detail: `${pending} pendente(s)` };
      }
      return { name: 'migrations', state: 'ok', detail: `${applied} aplicada(s)` };
    } catch (error) {
      return { name: 'migrations', state: 'down', detail: safeDetail(error) };
    }
  }
}

function aggregate(checks: DependencyHealth[]): HealthState {
  if (checks.some((check) => check.state === 'down')) return 'down';
  if (checks.some((check) => check.state === 'degraded')) return 'degraded';
  return 'ok';
}

/** Detalhe curto e sem segredo: nada de DSN, host interno ou stack (doc 09 §1). */
function safeDetail(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('timeout em ')) return error.message;
  return 'indisponível';
}
