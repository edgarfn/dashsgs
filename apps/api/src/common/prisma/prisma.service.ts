import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../config';

/**
 * Acesso ao PostgreSQL com o papel `app_rw` (sem BYPASSRLS — doc 08 §3).
 *
 * A partir da Fase 4 todo acesso a dados de tenant passa por `withTenant()`, que abre transação
 * e executa `SET LOCAL app.tenant_id`. O método já nasce aqui para que nenhum repositório
 * futuro invente o seu próprio caminho.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    super({
      datasourceUrl: config.databaseUrl,
      log: config.isDevelopment ? ['warn', 'error'] : ['error'],
    });
    this.logger.setContext(PrismaService.name);
  }

  async onModuleInit(): Promise<void> {
    const startedAt = Date.now();
    await this.$connect();
    // Aquece o engine: a primeira consulta paga o custo de inicializacao (~2 s). Melhor aqui,
    // no boot, do que no primeiro /readyz — que responderia 503 por um motivo que nao existe.
    await this.ping();
    this.logger.info(
      { event: 'db_connected', durationMs: Date.now() - startedAt },
      'postgres_ready',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Ping barato para o readiness (doc 18 §3). */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  /**
   * Confirma que o schema está na versão esperada: sem migração pendente, falha ou
   * revertida pela metade. Um deploy com migração pela metade não pode receber tráfego.
   */
  async migrationsHealth(): Promise<{ applied: number; pending: number; failed: number }> {
    const rows = await this.$queryRaw<Array<{ applied: bigint; pending: bigint; failed: bigint }>>`
      SELECT
        count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS pending,
        count(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS failed
      FROM _prisma_migrations
    `;
    const row = rows[0] ?? { applied: 0n, pending: 0n, failed: 0n };
    return {
      applied: Number(row.applied),
      pending: Number(row.pending),
      failed: Number(row.failed),
    };
  }

  /**
   * Executa `fn` dentro de uma transação com o contexto de tenant fixado na sessão do banco,
   * que é o que ativa as políticas de RLS (doc 08 §3). `SET LOCAL` garante escopo transacional,
   * seguro com pool de conexões: o valor morre no commit e não vaza para o próximo request que
   * pegar a mesma conexão.
   *
   * Os ids são validados como UUID antes de entrar no SQL — `SET LOCAL` não aceita parâmetro
   * ligado, então a validação **é** a defesa contra injeção aqui.
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: PrismaTransaction) => Promise<T>,
    options: { userId?: string } = {},
  ): Promise<T> {
    assertUuid(tenantId, 'tenantId');
    if (options.userId) assertUuid(options.userId, 'userId');

    return this.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
        if (options.userId) {
          await tx.$executeRawUnsafe(`SET LOCAL app.user_id = '${options.userId}'`);
        }
        return fn(tx as PrismaTransaction);
      },
      {
        // Os padrões do Prisma (2 s de espera, 5 s de duração) foram pensados para transações
        // pontuais. Aqui TODA leitura de dado de tenant é transacional — inclusive lotes de sync
        // (Fase 6) e picos com várias em paralelo. Prazos maiores evitam falha artificial sob
        // concorrência; o limite real continua sendo o pool de conexões.
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  }

  /**
   * Tabelas que têm `tenant_id` e não estão protegidas por RLS — deve ser sempre vazio
   * (doc 08 §6.3). Exposto aqui para o gate do CI e para o diagnóstico em produção.
   */
  async rlsGaps(): Promise<
    Array<{ table_name: string; rls_enabled: boolean; rls_forced: boolean; policy_count: number }>
  > {
    return this.$queryRaw`
      SELECT table_name, rls_enabled, rls_forced, policy_count FROM app_rls_gaps()
    `;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (!UUID.test(value)) {
    throw new Error(`contexto de banco exige UUID válido em ${field}`);
  }
}

export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
