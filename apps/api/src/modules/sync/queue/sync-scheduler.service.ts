import { Injectable } from '@nestjs/common';
import { SYNC_DOMAIN_INFO, SYNC_DOMAINS, type SyncDomain } from '@dashsgs/shared';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TenantDatabase } from '../../../common/tenant';
import { ErpConnectionService } from '../../erp-connection/erp-connection.service';
import { SyncQueueService } from './sync-queue.service';

/** Cadência do motor de alertas (doc 15 §8 + SLO de entrega ≤ 5 min do doc 18 §4). */
const CADENCIA_ALERTAS_SEGUNDOS = 300;

/**
 * Retenção uma vez por dia, de madrugada (doc 10 §2 / E6-04).
 *
 * Horário fixo, e não "a cada 24 h", porque purga é varredura: cai no vale do ERP e do banco,
 * longe do expediente da loja. O fuso é o do produto — o cliente é brasileiro, e "3h" tem que
 * ser 3h para ele, não para o servidor.
 */
const CRON_RETENCAO = '20 3 * * *';
const FUSO_RETENCAO = 'America/Sao_Paulo';

/** Prioridade na fila: menor número sai primeiro (BullMQ). Tempo real na frente, sempre. */
const PRIORIDADE: Record<SyncDomain, number> = {
  health: 2,
  vendas_hoje: 1,
  vendas_dia: 3,
  resumo_filial: 3,
  produtos: 4,
  dimensoes: 5,
  financeiro: 6,
  compras: 6,
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

    // Alertas não são um domínio de sync, mas têm cadência própria no mesmo agendador.
    await this.filas.sync.upsertJobScheduler(
      'tick:alertas',
      { every: CADENCIA_ALERTAS_SEGUNDOS * 1_000 },
      {
        name: 'tick:alertas',
        data: { tipo: 'alertas', domain: 'health' },
        opts: { priority: 2 },
      },
    );

    await this.filas.sync.upsertJobScheduler(
      'tick:retencao',
      { pattern: CRON_RETENCAO, tz: FUSO_RETENCAO },
      {
        name: 'tick:retencao',
        data: { tipo: 'retencao', domain: 'health' },
        opts: { priority: 8 },
      },
    );

    this.logger.info(
      {
        event: 'sync_cadencias_registradas',
        dominios: SYNC_DOMAINS.length,
        alertas: true,
        retencao: CRON_RETENCAO,
      },
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
