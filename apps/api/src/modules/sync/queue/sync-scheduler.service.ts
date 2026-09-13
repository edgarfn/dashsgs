import { Injectable } from '@nestjs/common';
import { SYNC_DOMAIN_INFO, SYNC_DOMAINS, type SyncDomain } from '@dashsgs/shared';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TenantDatabase } from '../../../common/tenant';
import { ErpConnectionService } from '../../erp-connection/erp-connection.service';
import { SyncQueueService } from './sync-queue.service';

/** Prioridade na fila: menor número sai primeiro (BullMQ). Tempo real na frente, sempre. */
const PRIORIDADE: Record<SyncDomain, number> = {
  health: 2,
  vendas_hoje: 1,
  vendas_dia: 3,
  resumo_filial: 3,
  produtos: 4,
  dimensoes: 5,
  backfill: 9,
};

/**
 * Agenda das cadências (doc 14 §2 / E5-01).
 *
 * O agendamento é por **domínio**, não por tenant: um job repetitivo por domínio acorda, olha
 * quem está ativo e enfileira o trabalho de cada um. Assim o número de jobs repetitivos não
 * cresce com a base de clientes, e tenant novo entra na cadência sem ninguém registrar nada.
 */
@Injectable()
export class SyncSchedulerService {
  constructor(
    private readonly filas: SyncQueueService,
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDatabase,
    private readonly conexoes: ErpConnectionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SyncSchedulerService.name);
  }

  /** Registra (ou atualiza) os jobs repetitivos. Idempotente: pode rodar a cada boot de worker. */
  async registrarCadencias(): Promise<void> {
    const agendados = await this.filas.sync.getJobSchedulers();
    for (const agendado of agendados) {
      if (agendado.id) await this.filas.sync.removeJobScheduler(agendado.id);
    }

    for (const domain of SYNC_DOMAINS) {
      const info = SYNC_DOMAIN_INFO[domain];
      if (info.cadenciaSegundos <= 0) continue;

      await this.filas.sync.upsertJobScheduler(
        `tick:${domain}`,
        { every: info.cadenciaSegundos * 1_000 },
        {
          name: `tick:${domain}`,
          data: { tipo: 'tick', domain },
          opts: { priority: PRIORIDADE[domain] },
        },
      );
    }

    this.logger.info(
      { event: 'sync_cadencias_registradas', dominios: SYNC_DOMAINS.length },
      'sync_cadencias_registradas',
    );
  }

  /**
   * Um tick: descobre quem precisa sincronizar este domínio e enfileira.
   *
   * Tenant suspenso, apagado ou com conexão em erro não entra — insistir contra um ERP que já
   * recusou só faria o disjuntor abrir e o log encher.
   */
  async processarTick(domain: SyncDomain): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'active', deletedAt: null },
      select: { id: true },
    });

    let enfileirados = 0;

    for (const tenant of tenants) {
      if (!(await this.conexoes.prontaParaSync(tenant.id))) continue;

      if (!SYNC_DOMAIN_INFO[domain].porFilial) {
        await this.filas.enfileirar(
          { tipo: 'dominio', tenantId: tenant.id, domain },
          { prioridade: PRIORIDADE[domain] },
        );
        enfileirados += 1;
        continue;
      }

      for (const filial of await this.filiaisAtivas(tenant.id)) {
        await this.filas.enfileirar(
          { tipo: 'dominio', tenantId: tenant.id, domain, filialErpId: filial },
          { prioridade: PRIORIDADE[domain] },
        );
        enfileirados += 1;
      }
    }

    return enfileirados;
  }

  /**
   * Filiais conhecidas do tenant. Enquanto o espelho estiver vazio (tenant novo), os domínios por
   * filial não têm o que fazer — é o job de dimensões que abre a porta para eles.
   */
  private async filiaisAtivas(tenantId: string): Promise<number[]> {
    const filiais = await this.tenantDb.run(tenantId, (tx) =>
      tx.erpFilial.findMany({
        where: { ativa: true },
        select: { erpId: true },
        orderBy: { erpId: 'asc' },
      }),
    );
    return filiais.map((filial) => filial.erpId);
  }
}
