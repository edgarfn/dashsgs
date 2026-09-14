import { Injectable } from '@nestjs/common';
import { SEVERIDADE_LABEL, type AlertSeverity } from '@dashsgs/shared';
import { PinoLogger } from 'nestjs-pino';
import { MailService } from '../../common/mail';
import { MetricsService } from '../../common/metrics/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDatabase } from '../../common/tenant';
import { AppConfigService } from '../../config';

/** Papéis que recebem cada tipo de aviso (doc 15 §8: "canais configuráveis" por audiência). */
const PAPEIS = {
  operacao: ['owner', 'admin', 'manager'],
  administracao: ['owner', 'admin'],
} as const;

export interface PedidoDeNotificacao {
  tenantId: string;
  alertEventId: string;
  audiencia: string;
  severity: AlertSeverity;
  titulo: string;
  resumo: string;
  link?: string;
}

/**
 * Entrega de alertas por e-mail (E8-02).
 *
 * O registro em `app_notifications` vem **antes** do envio, e é atualizado depois: se o SMTP cair,
 * fica gravado que o alerta existia e não saiu — que é a pergunta do plantão ("o cliente foi
 * avisado?"). Falha de envio nunca derruba o motor: o evento já está no feed, que é o canal que
 * não depende de terceiro.
 */
@Injectable()
export class NotificacoesService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificacoesService.name);
  }

  async enviar(pedido: PedidoDeNotificacao): Promise<number> {
    const destinatarios = await this.destinatarios(pedido.tenantId, pedido.audiencia);
    if (destinatarios.length === 0) {
      this.logger.warn(
        { event: 'alerta_sem_destinatario', tenant_id: pedido.tenantId },
        'alerta_sem_destinatario',
      );
      return 0;
    }

    const registros = await this.tenantDb.run(pedido.tenantId, (tx) =>
      tx.notification.createManyAndReturn({
        data: destinatarios.map((usuario) => ({
          tenantId: pedido.tenantId,
          userId: usuario.id,
          alertEventId: pedido.alertEventId,
          channel: 'email',
        })),
        select: { id: true, userId: true },
      }),
    );

    const emailPorUsuario = new Map(destinatarios.map((usuario) => [usuario.id, usuario]));

    // Em paralelo: são mensagens independentes, e o gerente da loja 2 não tem por que esperar a
    // entrega da loja 1. O pool do transporte limita quantas conexões saem de fato.
    const resultados = await Promise.all(
      registros.map(async (registro) => {
        const usuario = emailPorUsuario.get(registro.userId);
        if (!usuario) return false;

        const ok = await this.mail.send(this.montarEmail(pedido, usuario));

        await this.tenantDb.run(pedido.tenantId, (tx) =>
          tx.notification.update({
            where: { id: registro.id },
            data: ok
              ? { status: 'sent', sentAt: new Date() }
              : { status: 'failed', error: 'falha no envio do e-mail' },
          }),
        );

        return ok;
      }),
    );

    const enviados = resultados.filter(Boolean).length;

    this.metrics.alertNotificationsTotal.inc(
      { tenant: pedido.tenantId, result: enviados > 0 ? 'sent' : 'failed' },
      registros.length,
    );

    return enviados;
  }

  /**
   * Quem recebe: membros ativos do tenant cujo papel está na audiência da regra.
   *
   * A consulta é feita com o Prisma direto (não pelo contexto de tenant) porque `app_users` é
   * tabela de identidade, fora da RLS de tenant — o recorte vem do `where` pelo membership.
   */
  private async destinatarios(
    tenantId: string,
    audiencia: string,
  ): Promise<Array<{ id: string; email: string; name: string }>> {
    const papeis = PAPEIS[audiencia as keyof typeof PAPEIS] ?? PAPEIS.operacao;

    const memberships = await this.prisma.membership.findMany({
      where: {
        tenantId,
        role: { in: papeis as unknown as Array<'owner' | 'admin' | 'manager'> },
        user: { status: 'active', deletedAt: null },
      },
      select: { user: { select: { id: true, email: true, name: true } } },
    });

    return memberships.map((membership) => membership.user);
  }

  private montarEmail(pedido: PedidoDeNotificacao, usuario: { email: string; name: string }) {
    const nome = usuario.name;
    const severidade = SEVERIDADE_LABEL[pedido.severity];
    const url = pedido.link
      ? `${this.config.appUrl}${pedido.link}`
      : `${this.config.appUrl}/alertas`;

    const assunto = `[DashSGS · ${severidade}] ${pedido.titulo}`;
    const texto = [
      `Olá, ${nome.split(' ')[0]}.`,
      '',
      pedido.resumo,
      '',
      `Ver no DashSGS: ${url}`,
      '',
      'Para ajustar ou desligar este aviso: DashSGS → Alertas → Regras.',
    ].join('\n');

    const html = `
      <p>Olá, ${escapar(nome.split(' ')[0] ?? '')}.</p>
      <p><strong>${escapar(pedido.resumo)}</strong></p>
      <p><a href="${escapar(url)}">Ver no DashSGS</a></p>
      <p style="color:#666;font-size:12px">
        Para ajustar ou desligar este aviso: DashSGS → Alertas → Regras.
      </p>`;

    return { to: usuario.email, subject: assunto, text: texto, html };
  }
}

/** O texto vem do nosso motor, mas passa por descrição de produto vinda do ERP: escapamos. */
function escapar(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
