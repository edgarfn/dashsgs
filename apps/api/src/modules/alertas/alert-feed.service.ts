import { Injectable } from '@nestjs/common';
import {
  ALERT_TYPE_INFO,
  SEVERIDADE_PESO,
  type AlertSeverity,
  type AlertStatus,
  type AlertType,
} from '@dashsgs/shared';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../../common/audit';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import { AppException } from '../../common/errors/app.exception';
import { TenantDatabase } from '../../common/tenant';

export interface EventoView {
  id: string;
  tipo: AlertType;
  titulo: string;
  severidade: AlertSeverity;
  status: AlertStatus;
  filialErpId: number | null;
  resumo: string;
  link: string | null;
  payload: Record<string, unknown>;
  criadoEm: string;
  reconhecidoEm: string | null;
  reconhecidoPor: string | null;
}

export interface FeedView {
  eventos: EventoView[];
  contagens: { abertos: number; reconhecidos: number; criticos: number };
  paginacao: { pagina: number; itensPorPagina: number; total: number; paginas: number };
}

/**
 * Feed de alertas (E8-02).
 *
 * Ordem: severidade primeiro, recência depois. Um alerta crítico de ontem importa mais que um
 * aviso médio de agora — a lista existe para dizer o que fazer, não para contar a história.
 *
 * Reconhecer (`ack`) não resolve o problema: marca que alguém assumiu. A distinção importa numa
 * rede com vários gerentes olhando o mesmo feed.
 */
@Injectable()
export class AlertFeedService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AlertFeedService.name);
  }

  async listar(
    tenantId: string,
    filtros: {
      status?: AlertStatus;
      severidade?: AlertSeverity;
      filialErpId?: number;
      pagina: number;
      itensPorPagina: number;
    },
  ): Promise<FeedView> {
    const where = {
      ...(filtros.status ? { status: filtros.status } : {}),
      ...(filtros.severidade ? { severity: filtros.severidade } : {}),
      ...(filtros.filialErpId !== undefined ? { filialErpId: filtros.filialErpId } : {}),
    };

    const [eventos, total, abertos, reconhecidos, criticos] = await this.tenantDb.run(
      tenantId,
      async (tx) => [
        await tx.alertEvent.findMany({
          where,
          include: { rule: { select: { type: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (filtros.pagina - 1) * filtros.itensPorPagina,
          take: filtros.itensPorPagina,
        }),
        await tx.alertEvent.count({ where }),
        await tx.alertEvent.count({ where: { status: 'open' } }),
        await tx.alertEvent.count({ where: { status: 'acknowledged' } }),
        await tx.alertEvent.count({ where: { status: 'open', severity: 'critica' } }),
      ],
    );

    const view = eventos.map((evento) => this.paraView(evento));

    // Ordenação final em memória: a severidade é um enum no banco, e ordenar por ela lá exigiria
    // um CASE; a página já veio pequena, então ordenar aqui é mais simples e igualmente correto.
    view.sort((a, b) => {
      const peso = SEVERIDADE_PESO[a.severidade] - SEVERIDADE_PESO[b.severidade];
      return peso !== 0 ? peso : b.criadoEm.localeCompare(a.criadoEm);
    });

    return {
      eventos: view,
      contagens: { abertos, reconhecidos, criticos },
      paginacao: {
        pagina: filtros.pagina,
        itensPorPagina: filtros.itensPorPagina,
        total,
        paginas: Math.max(1, Math.ceil(total / filtros.itensPorPagina)),
      },
    };
  }

  /** Quantos alertas abertos existem — o número que a home mostra. */
  async abertos(tenantId: string): Promise<{ total: number; criticos: number }> {
    const [total, criticos] = await this.tenantDb.run(tenantId, async (tx) => [
      await tx.alertEvent.count({ where: { status: 'open' } }),
      await tx.alertEvent.count({ where: { status: 'open', severity: 'critica' } }),
    ]);

    return { total, criticos };
  }

  async reconhecer(
    auth: AuthContext,
    tenantId: string,
    id: string,
    identity: RequestIdentity,
  ): Promise<EventoView> {
    const evento = await this.tenantDb.run(tenantId, (tx) =>
      tx.alertEvent.findUnique({ where: { id }, include: { rule: true } }),
    );

    if (!evento) {
      throw new AppException('NOT_FOUND', { message: 'Alerta não encontrado.' });
    }

    // Reconhecer duas vezes não é erro: dois gerentes clicando juntos é o caso normal.
    if (evento.status === 'open') {
      await this.tenantDb.run(tenantId, (tx) =>
        tx.alertEvent.update({
          where: { id },
          data: { status: 'acknowledged', ackedBy: auth.user.id, ackedAt: new Date() },
        }),
      );

      await this.audit.record({
        action: 'alert.acknowledged',
        resourceType: 'alert_event',
        resourceId: id,
        result: 'success',
        tenantId,
        userId: auth.user.id,
        sessionId: auth.session.id,
        ip: identity.ip,
        userAgent: identity.userAgent,
        changes: { tipo: evento.rule.type, severidade: evento.severity },
      });
    }

    const atualizado = await this.tenantDb.run(tenantId, (tx) =>
      tx.alertEvent.findUniqueOrThrow({ where: { id }, include: { rule: true } }),
    );

    return this.paraView(atualizado);
  }

  private paraView(evento: {
    id: string;
    severity: string;
    status: string;
    filialErpId: number | null;
    payload: unknown;
    createdAt: Date;
    ackedAt: Date | null;
    ackedBy: string | null;
    rule: { type: string; name?: string };
  }): EventoView {
    const payload = (evento.payload as Record<string, unknown>) ?? {};
    const tipo = evento.rule.type as AlertType;

    return {
      id: evento.id,
      tipo,
      titulo: ALERT_TYPE_INFO[tipo]?.label ?? tipo,
      severidade: evento.severity as AlertSeverity,
      status: evento.status as AlertStatus,
      filialErpId: evento.filialErpId,
      resumo: typeof payload.resumo === 'string' ? payload.resumo : '',
      link: typeof payload.link === 'string' ? payload.link : null,
      payload,
      criadoEm: evento.createdAt.toISOString(),
      reconhecidoEm: evento.ackedAt?.toISOString() ?? null,
      reconhecidoPor: evento.ackedBy,
    };
  }
}
