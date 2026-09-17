import {
  AUDIT_ACOES,
  buildPaginated,
  categoriaDaAcao,
  acaoSensivel,
  rotuloDaAcao,
  type AuditEntryView,
  type AuditResultado,
  type Paginated,
} from '@dashsgs/shared';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface FiltroAuditoria {
  de?: string;
  ate?: string;
  acao?: string;
  categoria?: string;
  resultado?: AuditResultado;
  atorId?: string;
  recursoTipo?: string;
  page: number;
  pageSize: number;
}

/** Teto do export direto. Acima disso o caminho é o assíncrono da E6-06, ainda não construído. */
export const MAX_LINHAS_EXPORT = 20_000;

/**
 * Consulta da trilha de auditoria do tenant (E6-01, doc 16 §2).
 *
 * **O recorte não pode ser deixado para a RLS.** A tabela usa a política de *identidade*
 * (`app_enable_identity_rls`), que aceita `tenant_id IS NULL` — e precisa aceitar, porque eventos
 * de login acontecem antes de existir tenant na sessão. Confiar só nela faria o administrador de
 * uma rede ver as tentativas de login de todas as outras.
 *
 * O recorte correto é por **pessoa**: a trilha de um tenant é o que aconteceu no tenant
 * (`tenant_id = :id`) mais o que os membros dele fizeram antes de escolher tenant
 * (`tenant_id IS NULL AND user_id IN (membros)`). Eventos com os dois nulos — tentativa de login
 * de um e-mail que não existe — são de plataforma e não entram na visão de ninguém: mostrá-los
 * contaria a um cliente que alguém tentou entrar na conta de outro.
 *
 * A RLS continua valendo por baixo, como piso. O que muda é que ela deixou de ser o filtro.
 */
@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(tenantId: string, filtro: FiltroAuditoria): Promise<Paginated<AuditEntryView>> {
    const where = await this.where(tenantId, filtro);

    const [total, linhas] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (filtro.page - 1) * filtro.pageSize,
        take: filtro.pageSize,
        select: CAMPOS,
      }),
    ]);

    return buildPaginated(await this.comAtores(linhas), total, {
      page: filtro.page,
      pageSize: filtro.pageSize,
    });
  }

  /**
   * Mesma consulta, sem paginação e com teto. O export é o que o auditor leva para fora — e por
   * isso ele é registrado na própria trilha por quem o chamou (ver o controller).
   */
  async exportar(
    tenantId: string,
    filtro: Omit<FiltroAuditoria, 'page' | 'pageSize'>,
  ): Promise<{ linhas: AuditEntryView[]; truncado: boolean }> {
    const where = await this.where(tenantId, filtro);

    const linhas = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: MAX_LINHAS_EXPORT + 1,
      select: CAMPOS,
    });

    const truncado = linhas.length > MAX_LINHAS_EXPORT;
    return {
      linhas: await this.comAtores(linhas.slice(0, MAX_LINHAS_EXPORT)),
      truncado,
    };
  }

  /** Ações presentes na trilha do tenant — alimenta o filtro sem oferecer o que nunca aconteceu. */
  async acoesDisponiveis(tenantId: string): Promise<string[]> {
    const escopo = await this.escopo(tenantId);
    const linhas = await this.prisma.auditLog.findMany({
      where: escopo,
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return linhas.map((linha) => linha.action);
  }

  private async where(
    tenantId: string,
    filtro: Omit<FiltroAuditoria, 'page' | 'pageSize'>,
  ): Promise<Prisma.AuditLogWhereInput> {
    const where: Prisma.AuditLogWhereInput = await this.escopo(tenantId);

    if (filtro.de) where.createdAt = { gte: new Date(`${filtro.de}T00:00:00.000Z`) };
    if (filtro.ate) {
      where.createdAt = {
        ...(where.createdAt as object),
        // Fim do dia inclusivo: filtrar "até 17/09" e não ver o que aconteceu no dia 17 é o tipo
        // de surpresa que faz o auditor desconfiar da ferramenta inteira.
        lte: new Date(`${filtro.ate}T23:59:59.999Z`),
      };
    }
    if (filtro.acao) where.action = filtro.acao;
    if (filtro.resultado) where.result = filtro.resultado;
    if (filtro.atorId) where.userId = filtro.atorId;
    if (filtro.recursoTipo) where.resourceType = filtro.recursoTipo;

    // Categoria é do catálogo, não do banco: vira a lista de ações daquela categoria. Filtrar por
    // um grupo que o catálogo conhece e o banco não devolve nada — e nada é a resposta certa,
    // porque é isso que existe.
    if (filtro.categoria) {
      const acoes = Object.entries(AUDIT_ACOES)
        .filter(([, info]) => info.categoria === filtro.categoria)
        .map(([acao]) => acao);
      where.action = filtro.acao ? filtro.acao : { in: acoes };
    }

    return where;
  }

  /** O recorte de quem pode aparecer na trilha deste tenant — ver o cabeçalho da classe. */
  private async escopo(tenantId: string): Promise<Prisma.AuditLogWhereInput> {
    const membros = await this.prisma.membership.findMany({
      where: { tenantId },
      select: { userId: true },
    });
    const ids = membros.map((membro) => membro.userId);

    const alternativas: Prisma.AuditLogWhereInput[] = [{ tenantId }];
    if (ids.length > 0) {
      // Membro sem tenant na sessão: login, MFA, troca de senha. Sem esta metade a tela não
      // mostraria nenhum login — e login é o primeiro evento que qualquer auditoria procura.
      alternativas.push({ tenantId: null, userId: { in: ids } });
    }

    return { OR: alternativas };
  }

  /** Nome e e-mail do ator, resolvidos em uma consulta só. */
  private async comAtores(linhas: LinhaBruta[]): Promise<AuditEntryView[]> {
    const ids = [...new Set(linhas.map((linha) => linha.userId).filter(Boolean))] as string[];

    const usuarios = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, email: true },
        })
      : [];

    const porId = new Map(usuarios.map((usuario) => [usuario.id, usuario]));

    return linhas.map((linha) => {
      const usuario = linha.userId ? porId.get(linha.userId) : undefined;

      return {
        id: linha.id.toString(),
        createdAt: linha.createdAt.toISOString(),
        acao: linha.action,
        acaoLabel: rotuloDaAcao(linha.action),
        categoria: categoriaDaAcao(linha.action),
        sensivel: acaoSensivel(linha.action),
        resultado: linha.result as AuditResultado,
        recursoTipo: linha.resourceType,
        recursoId: linha.resourceId,
        ator: usuario ? { userId: usuario.id, nome: usuario.name, email: usuario.email } : null,
        ip: linha.ip,
        changes: (linha.changes as Record<string, unknown> | null) ?? null,
      };
    });
  }
}

const CAMPOS = {
  id: true,
  createdAt: true,
  action: true,
  resourceType: true,
  resourceId: true,
  result: true,
  userId: true,
  ip: true,
  changes: true,
} as const;

interface LinhaBruta {
  id: bigint;
  createdAt: Date;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  userId: string | null;
  ip: string | null;
  changes: unknown;
}
