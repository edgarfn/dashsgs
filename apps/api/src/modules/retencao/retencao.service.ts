import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../../common/audit';
import { MetricsService } from '../../common/metrics/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDatabase } from '../../common/tenant';
import { POLITICAS, calcularCorte, descreverPrazo, type PoliticaRetencao } from './politicas';

/** Linhas por instrução. Grande o bastante para andar, pequeno o bastante para não travar tabela. */
const TAMANHO_LOTE = 5_000;

/**
 * Teto por política em uma execução. Um tenant que passou meses sem purga não pode transformar a
 * rodada noturna em uma varredura de horas — o que sobrar sai na noite seguinte.
 */
const TETO_POR_POLITICA = 200_000;

/** Nome de tabela e de coluna nunca vêm de fora, mas a validação é barata e o risco é total. */
const IDENTIFICADOR = /^[a-z][a-z0-9_]*$/;

export interface PendenciaRetencao {
  politica: string;
  tabela: string;
  escopo: 'identidade' | 'tenant';
  prazo: string;
  /** Data de corte aplicada (a do tenant mais antigo, quando o prazo é configurável). */
  corte: string;
  /** Linhas vencidas ainda presentes. O critério de aceite do E6-04 é este número zerado. */
  pendentes: number;
  origem: string;
}

export interface LinhaPurga {
  politica: string;
  removidos: number;
}

export interface ResultadoPurga {
  removidos: number;
  duracaoMs: number;
  porPolitica: LinhaPurga[];
}

/**
 * Purga por retenção (E6-04, doc 10 §2).
 *
 * Duas operações sobre o **mesmo** catálogo: `purgar()` apaga o que venceu e `verificar()` conta
 * o que deveria ter sido apagado. Se a verificação não zera depois da purga, alguma política não
 * está sendo cumprida — e é isso que o critério de aceite do backlog cobra.
 *
 * O acesso a dado de tenant continua passando pela porta única (`TenantDatabase`): a purga roda
 * dentro do contexto de cada tenant, um por vez, e a RLS segue valendo. Um erro de SQL aqui
 * apaga demais de um cliente, nunca de todos.
 */
@Injectable()
export class RetencaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDatabase,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RetencaoService.name);
  }

  /** O catálogo como o painel da plataforma mostra — sem tocar no banco. */
  catalogo(): Array<Pick<PoliticaRetencao, 'id' | 'tabela' | 'escopo' | 'origem' | 'motivo'>> {
    return POLITICAS.map((politica) => ({
      id: politica.id,
      tabela: politica.tabela,
      escopo: politica.escopo,
      origem: politica.origem,
      motivo: politica.motivo,
    }));
  }

  /**
   * Quanto ainda está fora da retenção. Zero em todas as linhas é o estado correto do sistema.
   *
   * Também alimenta o gauge: assim o desvio aparece no painel antes de alguém perguntar.
   */
  async verificar(): Promise<PendenciaRetencao[]> {
    const agora = new Date();
    const tenants = await this.tenantsAtivos();
    const resultado: PendenciaRetencao[] = [];

    for (const politica of POLITICAS) {
      let pendentes = 0;
      let corte = calcularCorte(politica.prazo, agora, 26);

      if (politica.escopo === 'identidade') {
        pendentes = await this.contar(this.prisma, politica, corte);
      } else {
        for (const tenant of tenants) {
          const corteTenant = calcularCorte(politica.prazo, agora, tenant.retentionSalesMonths);
          if (corteTenant < corte) corte = corteTenant;
          pendentes += await this.tenantDb.runJob(
            { tenantId: tenant.id, jobId: `retencao-verificar--${politica.id}` },
            async (tx) => this.contar(tx, politica, corteTenant),
          );
        }
      }

      this.metrics.retentionPendingRows.set({ policy: politica.id }, pendentes);
      resultado.push({
        politica: politica.id,
        tabela: politica.tabela,
        escopo: politica.escopo,
        prazo: descreverPrazo(politica.prazo, 26),
        corte: corte.toISOString(),
        pendentes,
        origem: politica.origem,
      });
    }

    return resultado;
  }

  /** Apaga o que venceu. Idempotente por natureza: rodar duas vezes seguidas remove zero na segunda. */
  async purgar(): Promise<ResultadoPurga> {
    const inicio = Date.now();
    const agora = new Date();
    const tenants = await this.tenantsAtivos();
    const porPolitica: LinhaPurga[] = [];
    let removidos = 0;

    for (const politica of POLITICAS) {
      let removidosDaPolitica = 0;

      if (politica.escopo === 'identidade') {
        removidosDaPolitica = await this.apagarVencidos(
          this.prisma,
          politica,
          calcularCorte(politica.prazo, agora, 26),
        );
      } else {
        for (const tenant of tenants) {
          const corte = calcularCorte(politica.prazo, agora, tenant.retentionSalesMonths);
          removidosDaPolitica += await this.tenantDb.runJob(
            { tenantId: tenant.id, jobId: `retencao--${politica.id}` },
            async (tx) => this.apagarVencidos(tx, politica, corte),
          );
        }
      }

      if (removidosDaPolitica > 0) {
        this.metrics.retentionRowsPurgedTotal.inc({ policy: politica.id }, removidosDaPolitica);
      }
      removidos += removidosDaPolitica;
      porPolitica.push({ politica: politica.id, removidos: removidosDaPolitica });
    }

    const duracaoMs = Date.now() - inicio;
    this.metrics.retentionLastRunSeconds.set(Math.floor(Date.now() / 1_000));

    this.logger.info(
      { event: 'retencao_executada', removidos, duracaoMs, politicas: POLITICAS.length },
      'retencao_executada',
    );

    // A purga é irreversível: quem apagou, quanto e quando fica na trilha, sempre — inclusive
    // quando não havia nada a apagar, que é a prova de que o job rodou.
    await this.audit.record({
      action: 'retencao.purge',
      resourceType: 'retencao',
      resourceId: 'diaria',
      result: 'success',
      changes: {
        removidos,
        duracaoMs,
        porPolitica: porPolitica.filter((linha) => linha.removidos > 0),
      },
    });

    return { removidos, duracaoMs, porPolitica };
  }

  private async tenantsAtivos(): Promise<Array<{ id: string; retentionSalesMonths: number }>> {
    return this.prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, retentionSalesMonths: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async contar(
    executor: ExecutorSql,
    politica: PoliticaRetencao,
    corte: Date,
  ): Promise<number> {
    const { tabela, coluna, tipoColuna } = this.validar(politica);
    const linhas = await executor.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT count(*)::bigint AS total FROM ${tabela} WHERE ${coluna} < $1::${tipoColuna}`,
      this.parametroDeCorte(politica, corte),
    );
    return Number(linhas[0]?.total ?? 0);
  }

  /**
   * Apaga em lotes até acabar ou bater o teto.
   *
   * O `ctid` no lugar da chave primária é de propósito: as tabelas do espelho têm chave composta
   * de cinco colunas, e o endereço físico da linha serve para todas sem uma consulta por tabela.
   */
  private async apagarVencidos(
    executor: ExecutorSql,
    politica: PoliticaRetencao,
    corte: Date,
  ): Promise<number> {
    const { tabela, coluna, tipoColuna } = this.validar(politica);
    const parametro = this.parametroDeCorte(politica, corte);
    let total = 0;

    while (total < TETO_POR_POLITICA) {
      const lote = politica.funcaoPurga
        ? await this.purgarPorFuncao(executor, politica.funcaoPurga)
        : await executor.$executeRawUnsafe(
            `DELETE FROM ${tabela} WHERE ctid IN (
               SELECT ctid FROM ${tabela} WHERE ${coluna} < $1::${tipoColuna} LIMIT ${TAMANHO_LOTE}
             )`,
            parametro,
          );

      total += lote;
      if (lote < TAMANHO_LOTE) break;
    }

    return total;
  }

  /**
   * Auditoria: a exclusão não passa por DELETE da aplicação — o papel não tem o privilégio e a
   * trigger recusa. Quem apaga é a função do banco, que só aceita linha já vencida (migração da
   * Fase 9). A imutabilidade continua de pé; o que existe é uma porta estreita para o vencimento.
   */
  private async purgarPorFuncao(executor: ExecutorSql, funcao: string): Promise<number> {
    if (!IDENTIFICADOR.test(funcao)) throw new Error(`função de purga inválida: ${funcao}`);
    const linhas = await executor.$queryRawUnsafe<Array<Record<string, number>>>(
      `SELECT ${funcao}(${TAMANHO_LOTE}) AS removidos`,
    );
    return Number(linhas[0]?.removidos ?? 0);
  }

  /** Coluna `date` compara com texto de data; `timestamptz` com o instante completo. */
  private parametroDeCorte(politica: PoliticaRetencao, corte: Date): string {
    return politica.tipoColuna === 'date' ? corte.toISOString().slice(0, 10) : corte.toISOString();
  }

  private validar(politica: PoliticaRetencao): {
    tabela: string;
    coluna: string;
    tipoColuna: string;
  } {
    if (!IDENTIFICADOR.test(politica.tabela) || !IDENTIFICADOR.test(politica.coluna)) {
      throw new Error(`política de retenção inválida: ${politica.id}`);
    }
    return {
      tabela: politica.tabela,
      coluna: politica.coluna,
      tipoColuna: politica.tipoColuna,
    };
  }
}

/** O mínimo de Prisma que a purga usa — serve tanto ao client quanto à transação de tenant. */
interface ExecutorSql {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
}
