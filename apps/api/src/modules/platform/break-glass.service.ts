import { Injectable } from '@nestjs/common';
import { type Role } from '@dashsgs/shared';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../../common/audit';
import { type AuthContext, type RequestIdentity } from '../../common/auth';
import { AppException } from '../../common/errors/app.exception';
import { MailService, breakGlassNoticeEmail } from '../../common/mail';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Prazo mínimo e máximo da concessão. O padrão (2 h) é o do runbook 22 §11 e vive no schema da
 * rota; o teto vive aqui, onde a regra não depende de quem chama: "esqueci de revogar" não pode
 * virar acesso permanente.
 */
const MINUTOS_MINIMO = 15;
const MINUTOS_MAXIMO = 480;

/**
 * Papéis que uma concessão pode conceder.
 *
 * `owner` e `admin` estão fora de propósito: quem investiga um problema de dados não precisa
 * gerenciar usuários, trocar a credencial do ERP nem mexer em plano — e o acesso excepcional que
 * pudesse fazer isso deixaria de ser excepcional para virar uma porta dos fundos permanente.
 */
const PAPEIS_PERMITIDOS: Role[] = ['viewer', 'analyst', 'manager'];

export interface ConcessaoView {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  ticket: string;
  justificativa: string;
  papel: Role;
  status: 'aguardando_aprovacao' | 'ativa' | 'expirada' | 'revogada';
  solicitante: { id: string; nome: string; email: string };
  aprovador: { id: string; nome: string } | null;
  criadaEm: string;
  aprovadaEm: string | null;
  expiraEm: string | null;
  revogadaEm: string | null;
  acessos: number;
}

export interface RelatorioBreakGlass {
  concessao: ConcessaoView;
  /** Uma linha por requisição feita sob a concessão — é o anexo do ticket. */
  acessos: Array<{ quando: string; rota: string; ip: string | null }>;
}

/**
 * Break-glass auditado (E9-03, doc 07 §4.5, runbook 22 §11).
 *
 * `platform_admin` não lê dado de negócio de cliente nenhum. Quando um incidente exige isso, o
 * caminho é este, e ele foi desenhado para ser incômodo na medida certa:
 *
 *  1. **Ticket e justificativa** — acesso sem motivo escrito não acontece.
 *  2. **Aprovação de uma segunda pessoa** — quem pede não aprova. É a única barreira que um
 *     operador mal-intencionado (ou uma conta roubada) não vence sozinho.
 *  3. **Prazo curto que expira sozinho** — o acesso acaba mesmo que ninguém se lembre dele.
 *  4. **Owner do tenant notificado na hora** — o dono do dado descobre enquanto a janela ainda
 *     está aberta e pode contestar, não três meses depois num relatório.
 *  5. **Relatório do que foi acessado** — rota a rota, para anexar ao ticket.
 */
@Injectable()
export class BreakGlassService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BreakGlassService.name);
  }

  async listar(): Promise<ConcessaoView[]> {
    const concessoes = await this.prisma.breakGlassGrant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        tenant: { select: { slug: true, name: true } },
        requester: { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true } },
      },
    });

    return concessoes.map((concessao) => this.paraView(concessao));
  }

  /** Passo 1: pedido com ticket e justificativa. Nasce sem valer nada. */
  async solicitar(
    auth: AuthContext,
    input: {
      tenantId: string;
      ticket: string;
      justificativa: string;
      papel: Role;
      minutos: number;
    },
    identity: RequestIdentity,
  ): Promise<ConcessaoView> {
    if (!PAPEIS_PERMITIDOS.includes(input.papel)) {
      throw new AppException('VALIDATION_ERROR', {
        message: `Break-glass concede no máximo o papel manager. Escolha entre: ${PAPEIS_PERMITIDOS.join(', ')}.`,
        details: [{ path: 'papel', rule: 'enum' }],
      });
    }

    const minutos = Math.min(Math.max(input.minutos, MINUTOS_MINIMO), MINUTOS_MAXIMO);
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: input.tenantId, deletedAt: null },
      select: { id: true, slug: true, name: true },
    });
    if (!tenant) throw AppException.notFound({ tenantId: input.tenantId });

    const concessao = await this.prisma.breakGlassGrant.create({
      data: {
        tenantId: tenant.id,
        requestedBy: auth.user.id,
        ticket: input.ticket,
        justification: input.justificativa,
        role: input.papel,
        ttlMinutes: minutos,
      },
      include: {
        tenant: { select: { slug: true, name: true } },
        requester: { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true } },
      },
    });

    await this.audit.record({
      action: 'breakglass.requested',
      resourceType: 'tenant',
      resourceId: tenant.id,
      result: 'success',
      tenantId: tenant.id,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: {
        grantId: concessao.id,
        ticket: input.ticket,
        justificativa: input.justificativa,
        papel: input.papel,
        minutos,
      },
    });

    return this.paraView(concessao);
  }

  /**
   * Passo 2: aprovação por **outra** pessoa. É daqui que o prazo começa a contar — aprovar é o
   * ato que abre a porta, e uma porta aberta às 3h que só será usada às 9h não faz sentido.
   */
  async aprovar(
    auth: AuthContext,
    grantId: string,
    identity: RequestIdentity,
  ): Promise<ConcessaoView> {
    const concessao = await this.buscar(grantId);

    if (concessao.requestedBy === auth.user.id) {
      throw new AppException('FORBIDDEN', {
        message: 'Quem solicita o acesso excepcional não pode aprová-lo (runbook 22 §11).',
      });
    }
    if (concessao.approvedAt) {
      throw new AppException('CONFLICT', { message: 'Esta concessão já foi aprovada.' });
    }
    if (concessao.revokedAt) {
      throw new AppException('CONFLICT', { message: 'Esta concessão foi revogada.' });
    }

    const agora = new Date();
    const expiraEm = new Date(agora.getTime() + concessao.ttlMinutes * 60_000);

    const atualizada = await this.prisma.breakGlassGrant.update({
      where: { id: grantId },
      data: { approvedBy: auth.user.id, approvedAt: agora, expiresAt: expiraEm },
      include: {
        tenant: { select: { slug: true, name: true } },
        requester: { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true } },
      },
    });

    await this.audit.record({
      action: 'breakglass.approved',
      resourceType: 'tenant',
      resourceId: concessao.tenantId,
      result: 'success',
      tenantId: concessao.tenantId,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: {
        grantId,
        solicitante: atualizada.requester.email,
        expiraEm: expiraEm.toISOString(),
        papel: concessao.role,
      },
    });

    await this.avisarOwners(atualizada, expiraEm);

    this.logger.warn(
      {
        event: 'breakglass_aprovado',
        grantId,
        tenantId: concessao.tenantId,
        operador: atualizada.requester.email,
        expiraEm: expiraEm.toISOString(),
      },
      'breakglass_aprovado',
    );

    return this.paraView(atualizada);
  }

  /** Encerra antes da hora. Qualquer operador da plataforma pode fechar a porta. */
  async revogar(
    auth: AuthContext,
    grantId: string,
    identity: RequestIdentity,
  ): Promise<ConcessaoView> {
    const concessao = await this.buscar(grantId);
    if (concessao.revokedAt) return this.relatorioInterno(grantId);

    const atualizada = await this.prisma.breakGlassGrant.update({
      where: { id: grantId },
      data: { revokedAt: new Date(), revokedBy: auth.user.id },
      include: {
        tenant: { select: { slug: true, name: true } },
        requester: { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true } },
      },
    });

    await this.audit.record({
      action: 'breakglass.revoked',
      resourceType: 'tenant',
      resourceId: concessao.tenantId,
      result: 'success',
      tenantId: concessao.tenantId,
      userId: auth.user.id,
      sessionId: auth.session.id,
      ip: identity.ip,
      userAgent: identity.userAgent,
      changes: { grantId, acessos: atualizada.accessCount },
    });

    return this.paraView(atualizada);
  }

  /** Passo 3: o que foi acessado, para anexar ao ticket. */
  async relatorio(grantId: string): Promise<RelatorioBreakGlass> {
    const concessao = await this.relatorioInterno(grantId);

    const acessos = await this.prisma.auditLog.findMany({
      where: {
        action: 'breakglass.access',
        tenantId: concessao.tenantId,
        changes: { path: ['grantId'], equals: grantId },
      },
      orderBy: { createdAt: 'asc' },
      take: 2_000,
      select: { createdAt: true, resourceId: true, ip: true },
    });

    return {
      concessao,
      acessos: acessos.map((acesso) => ({
        quando: acesso.createdAt.toISOString(),
        rota: acesso.resourceId ?? '',
        ip: acesso.ip,
      })),
    };
  }

  /**
   * O owner do tenant é avisado **quando o acesso é aberto**, não depois de fechado. Um aviso
   * que chega tarde demais informa; um que chega na hora permite reagir.
   */
  private async avisarOwners(
    concessao: {
      tenantId: string;
      ticket: string;
      justification: string;
      tenant: { name: string };
      requester: { name: string };
      approver: { name: string } | null;
    },
    expiraEm: Date,
  ): Promise<void> {
    const owners = await this.prisma.membership.findMany({
      where: { tenantId: concessao.tenantId, role: 'owner' },
      select: { user: { select: { email: true } } },
    });

    await Promise.all(
      owners.map(async (owner) =>
        this.mail.send(
          breakGlassNoticeEmail({
            to: owner.user.email,
            tenantName: concessao.tenant.name,
            operador: concessao.requester.name,
            aprovador: concessao.approver?.name ?? 'equipe DashSGS',
            ticket: concessao.ticket,
            justificativa: concessao.justification,
            expiraEm,
          }),
        ),
      ),
    );
  }

  private async buscar(grantId: string) {
    const concessao = await this.prisma.breakGlassGrant.findUnique({ where: { id: grantId } });
    if (!concessao) throw AppException.notFound({ grantId });
    return concessao;
  }

  private async relatorioInterno(grantId: string): Promise<ConcessaoView> {
    const concessao = await this.prisma.breakGlassGrant.findUnique({
      where: { id: grantId },
      include: {
        tenant: { select: { slug: true, name: true } },
        requester: { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true } },
      },
    });
    if (!concessao) throw AppException.notFound({ grantId });
    return this.paraView(concessao);
  }

  private paraView(concessao: {
    id: string;
    tenantId: string;
    ticket: string;
    justification: string;
    role: string;
    accessCount: number;
    createdAt: Date;
    approvedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    tenant: { slug: string; name: string };
    requester: { id: string; name: string; email: string };
    approver: { id: string; name: string } | null;
  }): ConcessaoView {
    return {
      id: concessao.id,
      tenantId: concessao.tenantId,
      tenantSlug: concessao.tenant.slug,
      tenantName: concessao.tenant.name,
      ticket: concessao.ticket,
      justificativa: concessao.justification,
      papel: concessao.role as Role,
      status: this.status(concessao),
      solicitante: {
        id: concessao.requester.id,
        nome: concessao.requester.name,
        email: concessao.requester.email,
      },
      aprovador: concessao.approver
        ? { id: concessao.approver.id, nome: concessao.approver.name }
        : null,
      criadaEm: concessao.createdAt.toISOString(),
      aprovadaEm: concessao.approvedAt?.toISOString() ?? null,
      expiraEm: concessao.expiresAt?.toISOString() ?? null,
      revogadaEm: concessao.revokedAt?.toISOString() ?? null,
      acessos: concessao.accessCount,
    };
  }

  private status(concessao: {
    approvedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
  }): ConcessaoView['status'] {
    if (concessao.revokedAt) return 'revogada';
    if (!concessao.approvedAt) return 'aguardando_aprovacao';
    if (!concessao.expiresAt || concessao.expiresAt <= new Date()) return 'expirada';
    return 'ativa';
  }
}
