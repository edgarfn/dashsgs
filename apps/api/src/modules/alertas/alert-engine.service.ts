import { Injectable } from '@nestjs/common';
import { ALERT_TYPE_INFO, type AlertType } from '@dashsgs/shared';
import { PinoLogger } from 'nestjs-pino';
import { diaEm } from '../../common/datas';
import { MetricsService } from '../../common/metrics/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDatabase } from '../../common/tenant';
import { AVALIADORES, type Ocorrencia } from './avaliadores';
import { AlertRulesService } from './alert-rules.service';
import { NotificacoesService } from './notificacoes.service';

export interface ResultadoAvaliacao {
  regrasAvaliadas: number;
  ocorrencias: number;
  eventosNovos: number;
  notificacoesEnviadas: number;
}

/**
 * Motor de alertas (E8-01).
 *
 * O ciclo é: para cada regra ligada, avaliar o espelho, transformar ocorrência em evento **se ele
 * ainda não existir** (chave de dedupe) e notificar só o que é novo.
 *
 * O dedupe é o coração da coisa. Sem ele, uma loja com 40 itens de curva A em falta geraria 40
 * e-mails às 8h, 40 às 8h05, 40 às 8h10 — e o cliente criaria uma regra no Outlook para mandar
 * tudo para a lixeira. Com ele, é um e-mail por problema por dia.
 *
 * Ele roda **fora** do caminho do sync, e isso é deliberado: o alerta mais importante de todos é
 * "a integração parou", e ele precisa disparar justamente quando o sync não está funcionando.
 */
@Injectable()
export class AlertEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDatabase,
    private readonly regras: AlertRulesService,
    private readonly notificacoes: NotificacoesService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AlertEngine.name);
  }

  /** Avalia todos os tenants ativos — é o que o tick do worker chama. */
  async avaliarTodos(): Promise<{ tenants: number; eventos: number }> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'active', deletedAt: null },
      select: { id: true, timezone: true },
    });

    let eventos = 0;
    for (const tenant of tenants) {
      try {
        const resultado = await this.avaliar(tenant.id, tenant.timezone);
        eventos += resultado.eventosNovos;
      } catch (erro) {
        // Um tenant com problema não pode calar os alertas dos outros (doc 14 §1, mesma regra).
        this.logger.error(
          {
            event: 'alerta_avaliacao_falhou',
            tenant_id: tenant.id,
            erro: erro instanceof Error ? erro.message : 'falha inesperada',
          },
          'alerta_avaliacao_falhou',
        );
      }
    }

    return { tenants: tenants.length, eventos };
  }

  async avaliar(tenantId: string, timezone = 'America/Sao_Paulo'): Promise<ResultadoAvaliacao> {
    const agora = new Date();
    const hoje = diaEm(agora, timezone);
    const horaLocal = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
      }).format(agora),
    );

    const regras = await this.regras.ativas(tenantId);
    let ocorrenciasTotais = 0;
    let eventosNovos = 0;
    let notificacoesEnviadas = 0;

    for (const regra of regras) {
      const avaliador = AVALIADORES[regra.type];
      if (!avaliador) continue;

      const ocorrencias = await this.tenantDb.run(tenantId, (tx) =>
        avaliador({ tx, tenantId, hoje, horaLocal, params: regra.params }),
      );
      ocorrenciasTotais += ocorrencias.length;

      for (const ocorrencia of ocorrencias) {
        const evento = await this.registrar(tenantId, regra.id, regra.severity, ocorrencia);
        if (!evento) continue;

        eventosNovos += 1;
        this.metrics.alertEventsTotal.inc({ tenant: tenantId, type: regra.type });

        if (regra.canalEmail) {
          const inicio = Date.now();
          notificacoesEnviadas += await this.notificacoes.enviar({
            tenantId,
            alertEventId: evento.id,
            audiencia: regra.audiencia,
            severity: regra.severity,
            titulo: ALERT_TYPE_INFO[regra.type as AlertType].label,
            resumo: ocorrencia.resumo,
            link: typeof ocorrencia.payload.link === 'string' ? ocorrencia.payload.link : undefined,
          });
          // SLO do doc 18 §4: evento → notificação em ≤ 5 min p95. Medimos o trecho que é nosso.
          this.metrics.alertDelivery.observe({ type: regra.type }, (Date.now() - inicio) / 1_000);
        }
      }
    }

    if (eventosNovos > 0) {
      this.logger.info(
        {
          event: 'alertas_gerados',
          tenant_id: tenantId,
          novos: eventosNovos,
          notificados: notificacoesEnviadas,
        },
        'alertas_gerados',
      );
    }

    return {
      regrasAvaliadas: regras.length,
      ocorrencias: ocorrenciasTotais,
      eventosNovos,
      notificacoesEnviadas,
    };
  }

  /**
   * Grava o evento se a chave ainda não existir. Devolve `null` quando já existia — é o caminho
   * normal: o mesmo problema continua lá, e ninguém precisa saber de novo.
   */
  private async registrar(
    tenantId: string,
    ruleId: string,
    severity: string,
    ocorrencia: Ocorrencia,
  ): Promise<{ id: string } | null> {
    return this.tenantDb.run(tenantId, async (tx) => {
      const existente = await tx.alertEvent.findUnique({
        where: {
          tenantId_ruleId_dedupeKey: { tenantId, ruleId, dedupeKey: ocorrencia.dedupeKey },
        },
        select: { id: true },
      });

      if (existente) return null;

      return tx.alertEvent.create({
        data: {
          tenantId,
          ruleId,
          filialErpId: ocorrencia.filialErpId,
          dedupeKey: ocorrencia.dedupeKey,
          severity: severity as never,
          payload: { resumo: ocorrencia.resumo, ...ocorrencia.payload },
        },
        select: { id: true },
      });
    });
  }
}
