import { Injectable } from '@nestjs/common';
import {
  ALERT_TYPES_DISPONIVEIS,
  ALERT_TYPE_INFO,
  type AlertSeverity,
  type AlertType,
} from '@dashsgs/shared';
import { PinoLogger } from 'nestjs-pino';
import { AppException } from '../../common/errors/app.exception';
import { TenantDatabase } from '../../common/tenant';

export interface RegraView {
  id: string;
  name: string;
  type: AlertType;
  severity: AlertSeverity;
  params: Record<string, number>;
  canalEmail: boolean;
  audiencia: string;
  enabled: boolean;
  /** Vem do catálogo, não do banco: é o que a tela usa para explicar a regra. */
  descricao: string;
  disponivel: boolean;
  dependencia?: string;
}

/**
 * Regras de alerta por tenant (E8-03).
 *
 * As regras padrão do doc 15 §8 são **semeadas na primeira visita**, e não na criação do tenant:
 * um tenant criado antes desta fase não teria regra nenhuma, e a tela mostraria vazio para sempre.
 * A semeadura é idempotente (chave única por tipo), então rodar de novo não duplica nem sobrescreve
 * o que o cliente já ajustou.
 */
@Injectable()
export class AlertRulesService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AlertRulesService.name);
  }

  /** Garante as regras padrão e devolve todas — é o que a tela e o motor consomem. */
  async listar(tenantId: string): Promise<RegraView[]> {
    await this.semearPadroes(tenantId);

    const regras = await this.tenantDb.run(tenantId, (tx) =>
      tx.alertRule.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    );

    return regras.map((regra) => this.paraView(regra));
  }

  /** Só as que o motor deve avaliar agora: ligadas e com avaliador disponível. */
  async ativas(tenantId: string): Promise<RegraView[]> {
    const regras = await this.listar(tenantId);
    return regras.filter((regra) => regra.enabled && regra.disponivel);
  }

  async atualizar(
    tenantId: string,
    id: string,
    mudancas: {
      enabled?: boolean;
      severity?: AlertSeverity;
      canalEmail?: boolean;
      params?: Record<string, number>;
    },
  ): Promise<RegraView> {
    const atual = await this.tenantDb.run(tenantId, (tx) =>
      tx.alertRule.findFirst({ where: { id, deletedAt: null } }),
    );

    // 404 e não 403: a regra de outro tenant simplesmente não existe daqui (doc 07 §5).
    if (!atual) {
      throw new AppException('NOT_FOUND', { message: 'Regra de alerta não encontrada.' });
    }

    const params = mudancas.params
      ? this.validarParams(atual.type as AlertType, mudancas.params)
      : undefined;

    const atualizada = await this.tenantDb.run(tenantId, (tx) =>
      tx.alertRule.update({
        where: { id },
        data: {
          enabled: mudancas.enabled,
          severity: mudancas.severity,
          canalEmail: mudancas.canalEmail,
          ...(params ? { params } : {}),
        },
      }),
    );

    this.logger.info(
      { event: 'alert_rule_updated', tenant_id: tenantId, tipo: atualizada.type },
      'alert_rule_updated',
    );

    return this.paraView(atualizada);
  }

  /**
   * Cria o que falta do catálogo. O tipo é único por tenant, então a regra ajustada pelo cliente
   * nunca é sobrescrita por uma execução posterior.
   */
  async semearPadroes(tenantId: string): Promise<number> {
    const existentes = await this.tenantDb.run(tenantId, (tx) =>
      tx.alertRule.findMany({ select: { type: true } }),
    );
    const jaTem = new Set(existentes.map((regra) => regra.type));

    const faltando = Object.entries(ALERT_TYPE_INFO).filter(([tipo]) => !jaTem.has(tipo as never));
    if (faltando.length === 0) return 0;

    await this.tenantDb.run(tenantId, (tx) =>
      tx.alertRule.createMany({
        data: faltando.map(([tipo, info]) => ({
          tenantId,
          name: info.label,
          type: tipo as never,
          severity: info.severidadePadrao as never,
          params: info.parametrosPadrao,
          audiencia: info.audienciaPadrao,
          canalEmail: true,
          // Regra sem avaliador nasce desligada: ligar algo que não roda seria promessa falsa.
          enabled: info.disponivel,
        })),
        skipDuplicates: true,
      }),
    );

    this.logger.info(
      { event: 'alert_rules_seeded', tenant_id: tenantId, criadas: faltando.length },
      'alert_rules_seeded',
    );

    return faltando.length;
  }

  /** Limiar fora de faixa vira erro de validação, não comportamento estranho meses depois. */
  private validarParams(tipo: AlertType, params: Record<string, number>): Record<string, number> {
    const padrao = ALERT_TYPE_INFO[tipo].parametrosPadrao;
    const resultado: Record<string, number> = { ...padrao };

    for (const [chave, valor] of Object.entries(params)) {
      if (!(chave in padrao)) {
        throw new AppException('VALIDATION_ERROR', {
          message: `Parâmetro desconhecido para esta regra: ${chave}`,
          details: [{ path: `params.${chave}`, rule: 'desconhecido' }],
        });
      }
      if (!Number.isFinite(valor) || valor < 0 || valor > 100_000) {
        throw new AppException('VALIDATION_ERROR', {
          message: `Valor inválido para ${chave}.`,
          details: [{ path: `params.${chave}`, rule: 'faixa' }],
        });
      }
      resultado[chave] = valor;
    }

    return resultado;
  }

  private paraView(regra: {
    id: string;
    name: string;
    type: string;
    severity: string;
    params: unknown;
    canalEmail: boolean;
    audiencia: string;
    enabled: boolean;
  }): RegraView {
    const tipo = regra.type as AlertType;
    const info = ALERT_TYPE_INFO[tipo];

    return {
      id: regra.id,
      name: regra.name,
      type: tipo,
      severity: regra.severity as AlertSeverity,
      params: (regra.params as Record<string, number>) ?? {},
      canalEmail: regra.canalEmail,
      audiencia: regra.audiencia,
      enabled: regra.enabled,
      descricao: info.descricao,
      disponivel: info.disponivel,
      dependencia: info.dependencia,
    };
  }
}

/** Tipos com avaliador — usado pelo motor e pelos testes para não repetir a lista. */
export const TIPOS_AVALIAVEIS = ALERT_TYPES_DISPONIVEIS;
