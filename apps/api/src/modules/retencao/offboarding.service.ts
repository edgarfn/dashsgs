import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../../common/audit';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { TenantDatabase } from '../../common/tenant';

/** Carência entre a exclusão lógica e a purga física (doc 08 §5). É o prazo do arrependimento. */
const DIAS_DE_CARENCIA = 30;

const IDENTIFICADOR = /^[a-z][a-z0-9_]*$/;

interface TabelaDoTenant {
  nome: string;
  /**
   * `true` para o template estrito (`app_required_tenant_id()`), em que toda linha da tabela
   * pertence ao tenant do contexto. `false` para o template de identidade, em que existe linha
   * com `tenant_id` nulo — e aí o recorte precisa ser explícito.
   */
  estrita: boolean;
}

export interface ResultadoOffboarding {
  tenantId: string;
  slug: string;
  /** Linhas apagadas por tabela — vai para a trilha como comprovante (LGPD art. 16). */
  porTabela: Record<string, number>;
  linhas: number;
  usuariosDesligados: number;
  chavesDeCache: number;
}

/**
 * Purga física do offboarding (E6-04, doc 08 §5).
 *
 * O caminho é: exportação sob demanda → exclusão lógica → **30 dias** → purga física → flush de
 * cache → registro de destruição. Este serviço é o trecho do meio para a frente.
 *
 * A lista de tabelas vem da introspecção — toda tabela com `tenant_id` — e não de uma lista
 * escrita à mão. Lista à mão envelhece: bastaria alguém criar uma tabela nova na Fase 11 para o
 * dado de um cliente desligado sobreviver sem ninguém perceber. O catálogo do Postgres não
 * esquece, e é ele também que diz qual template de RLS a tabela usa.
 *
 * Duas exceções deliberadas:
 *  - **`app_audit_log` fica**: é a prova da destruição, tem retenção própria de cinco anos e é
 *    append-only — apagá-la aqui destruiria justamente o comprovante.
 *  - **o registro do tenant fica**, como lápide (id, slug, `purged_at`): sem ele, as linhas da
 *    auditoria apontariam para um id que não existe mais.
 */
@Injectable()
export class OffboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDatabase,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OffboardingService.name);
  }

  /** Tenants excluídos logicamente há mais de 30 dias e ainda não purgados. */
  async pendentes(): Promise<Array<{ id: string; slug: string; deletedAt: Date }>> {
    const limite = new Date(Date.now() - DIAS_DE_CARENCIA * 86_400_000);
    const tenants = await this.prisma.tenant.findMany({
      where: { deletedAt: { not: null, lt: limite }, purgedAt: null },
      select: { id: true, slug: true, deletedAt: true },
      orderBy: { deletedAt: 'asc' },
    });
    return tenants.map((tenant) => ({
      id: tenant.id,
      slug: tenant.slug,
      deletedAt: tenant.deletedAt as Date,
    }));
  }

  /** Executa a purga de todos os tenants vencidos. Chamado pela rodada diária. */
  async purgarPendentes(): Promise<ResultadoOffboarding[]> {
    const resultados: ResultadoOffboarding[] = [];
    for (const tenant of await this.pendentes()) {
      resultados.push(await this.purgarTenant(tenant.id));
    }
    return resultados;
  }

  /**
   * Purga um tenant. Só aceita quem já está excluído logicamente: a purga é o fim de um processo
   * que começa em outro lugar, nunca um atalho para apagar cliente ativo.
   */
  async purgarTenant(tenantId: string): Promise<ResultadoOffboarding> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, deletedAt: true, purgedAt: true },
    });

    if (!tenant) throw new Error(`tenant inexistente: ${tenantId}`);
    if (!tenant.deletedAt) throw new Error(`tenant ${tenant.slug} não está excluído logicamente`);
    if (tenant.purgedAt) throw new Error(`tenant ${tenant.slug} já foi purgado`);

    const porTabela = await this.apagarTabelas(tenantId, await this.tabelasDoTenant());
    const usuariosDesligados = await this.desligarUsuariosOrfaos();
    const chavesDeCache = await this.redis.purgeTenant(tenantId);

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { purgedAt: new Date(), status: 'suspended' },
    });

    const linhas = Object.values(porTabela).reduce((soma, valor) => soma + valor, 0);

    // O comprovante de destruição (LGPD art. 16) é esta linha na trilha append-only.
    await this.audit.record({
      action: 'tenant.purged',
      resourceType: 'tenant',
      resourceId: tenantId,
      result: 'success',
      tenantId,
      changes: {
        slug: tenant.slug,
        excluidoEm: tenant.deletedAt.toISOString(),
        linhas,
        chavesDeCache,
        usuariosDesligados,
        porTabela: Object.fromEntries(
          Object.entries(porTabela).filter(([, quantidade]) => quantidade > 0),
        ),
      },
    });

    this.logger.info(
      { event: 'offboarding_concluido', tenantId, slug: tenant.slug, linhas, usuariosDesligados },
      'offboarding_concluido',
    );

    return { tenantId, slug: tenant.slug, porTabela, linhas, usuariosDesligados, chavesDeCache };
  }

  /**
   * Apaga as tabelas em rodadas: tenta todas, repete as que falharam por referência.
   *
   * É ordem de dependência sem mapa de chaves estrangeiras. Cada rodada apaga pelo menos uma
   * tabela folha, então o laço converge — e continua correto quando alguém criar uma relação
   * nova, que é exatamente o cenário em que uma ordem fixa em código falharia em silêncio.
   */
  private async apagarTabelas(
    tenantId: string,
    tabelas: TabelaDoTenant[],
  ): Promise<Record<string, number>> {
    const porTabela: Record<string, number> = {};
    let restantes = [...tabelas];

    while (restantes.length > 0) {
      const falharam: TabelaDoTenant[] = [];

      for (const tabela of restantes) {
        try {
          porTabela[tabela.nome] = await this.apagar(tenantId, tabela);
        } catch (erro) {
          falharam.push(tabela);
          this.logger.debug(
            { event: 'offboarding_adiado', tabela: tabela.nome, erro: (erro as Error).message },
            'offboarding_adiado',
          );
        }
      }

      if (falharam.length === restantes.length) {
        throw new Error(`purga travada em: ${falharam.map((t) => t.nome).join(', ')}`);
      }
      restantes = falharam;
    }

    return porTabela;
  }

  private async apagar(tenantId: string, tabela: TabelaDoTenant): Promise<number> {
    if (!IDENTIFICADOR.test(tabela.nome)) throw new Error(`tabela inválida: ${tabela.nome}`);

    // Tabela de identidade aceita linha com `tenant_id` nulo (sessão sem tenant escolhido, por
    // exemplo). Dentro do contexto do tenant, a política **também** deixa essas linhas
    // visíveis — um `DELETE FROM` ali levaria junto a sessão de gente de outro cliente. Por
    // isso o recorte explícito, fora do contexto.
    if (!tabela.estrita) {
      return this.prisma.$executeRawUnsafe(
        `DELETE FROM ${tabela.nome} WHERE tenant_id = $1::uuid`,
        tenantId,
      );
    }

    return this.tenantDb.runJob({ tenantId, jobId: `offboarding--${tabela.nome}` }, async (tx) =>
      tx.$executeRawUnsafe(`DELETE FROM ${tabela.nome}`),
    );
  }

  /**
   * Conta que ficou sem nenhum vínculo é marcada como excluída — a purga física dela vem seis
   * meses depois, pela política `usuarios_desligados` (doc 10 §2). Quem ainda serve outro tenant
   * não é tocado, e `platform_admin` nunca: a conta de operação não depende de membership.
   */
  private async desligarUsuariosOrfaos(): Promise<number> {
    return this.prisma.$executeRawUnsafe(
      `UPDATE app_users u
          SET deleted_at = now(), status = 'disabled'
        WHERE u.deleted_at IS NULL
          AND u.platform_admin = false
          AND NOT EXISTS (SELECT 1 FROM app_memberships m WHERE m.user_id = u.id)`,
    );
  }

  /**
   * Toda tabela do schema com coluna `tenant_id`, classificada pelo template de RLS que aplica.
   * Inclui as que ainda não existem hoje — é essa a garantia que o offboarding precisa dar.
   */
  private async tabelasDoTenant(): Promise<TabelaDoTenant[]> {
    const linhas = await this.prisma.$queryRawUnsafe<Array<{ tabela: string; estrita: boolean }>>(
      `SELECT c.table_name AS tabela,
              COALESCE(bool_or(p.qual LIKE '%app_required_tenant_id%'), false) AS estrita
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         LEFT JOIN pg_policies p
           ON p.schemaname = c.table_schema AND p.tablename = c.table_name
        WHERE c.table_schema = 'public'
          AND c.column_name = 'tenant_id'
          AND t.table_type = 'BASE TABLE'
          AND c.table_name <> 'app_audit_log'
        GROUP BY c.table_name
        ORDER BY c.table_name`,
    );

    return linhas
      .filter((linha) => IDENTIFICADOR.test(linha.tabela))
      .map((linha) => ({ nome: linha.tabela, estrita: linha.estrita }));
  }
}
