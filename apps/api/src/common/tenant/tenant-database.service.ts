import { Injectable } from '@nestjs/common';
import { getCorrelationStore, runWithCorrelation } from '../correlation/correlation.context';
import { AppException } from '../errors/app.exception';
import { PrismaService, type PrismaTransaction } from '../prisma/prisma.service';

/**
 * Porta de entrada para dados de tenant (doc 08 §3).
 *
 * Toda leitura ou escrita de dado de tenant passa por aqui, e nunca pelo `PrismaService` direto.
 * O motivo é que a RLS só protege se `app.tenant_id` estiver fixado na transação — e a regra do
 * projeto é que o tenant venha **sempre** da sessão do servidor, jamais de parâmetro do cliente.
 *
 * O RBAC decide *o que* pode ser feito; isto aqui decide *de quem* são as linhas.
 */
@Injectable()
export class TenantDatabase {
  constructor(private readonly prisma: PrismaService) {}

  /** Executa no contexto de um tenant explícito (jobs, administração da plataforma). */
  async run<T>(
    tenantId: string,
    fn: (tx: PrismaTransaction) => Promise<T>,
    options: { userId?: string } = {},
  ): Promise<T> {
    return this.prisma.withTenant(tenantId, fn, options);
  }

  /**
   * Executa no contexto do request corrente — o tenant ativo da sessão, colocado no contexto
   * assíncrono pelo guard de sessão. Sem tenant ativo, falha: é o caso de um usuário com vários
   * vínculos que ainda não escolheu, e a resposta certa é pedir a escolha, não adivinhar.
   */
  async runInCurrent<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T> {
    const store = getCorrelationStore();
    if (!store?.tenantId) {
      throw new AppException('VALIDATION_ERROR', {
        message: 'Selecione um tenant antes de continuar.',
        details: [{ path: 'tenant', rule: 'required' }],
      });
    }
    return this.run(store.tenantId, fn, { userId: store.userId });
  }

  /**
   * Abre um contexto de tenant para um trabalho assíncrono (workers da Fase 6).
   *
   * Cada job roda dentro do seu próprio contexto de correlação: dois jobs de tenants diferentes
   * processados pelo mesmo worker não se enxergam, nem no banco nem no log (doc 08 §6.5).
   */
  async runJob<T>(
    params: { tenantId: string; jobId: string; originCorrelationId?: string },
    fn: (tx: PrismaTransaction) => Promise<T>,
  ): Promise<T> {
    return runWithCorrelation(
      { correlationId: params.originCorrelationId ?? params.jobId, tenantId: params.tenantId },
      async () => this.run(params.tenantId, fn),
    );
  }

  /** Tenant do contexto corrente, quando houver. */
  currentTenantId(): string | undefined {
    return getCorrelationStore()?.tenantId;
  }
}
