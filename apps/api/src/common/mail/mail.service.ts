import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService, ENV } from '../../config';
import { type Env } from '../../config/env.schema';

export interface MailMessage {
  to: string;
  subject: string;
  /** Texto puro é o corpo canônico; o HTML é a versão enfeitada do mesmo conteúdo. */
  text: string;
  html: string;
}

/**
 * Envio transacional (convites, recuperação de senha, avisos de segurança).
 *
 * Em desenvolvimento o destino é o Mailpit do compose (http://localhost:8025), então o fluxo
 * completo é testável sem mandar e-mail para ninguém de verdade.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(
    @Inject(ENV) env: Env,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MailService.name);
    this.from = env.MAIL_FROM;
    // A URL é desmontada em opções explícitas de propósito: passar `tls` no segundo argumento
    // de `createTransport` não configura o transporte — ali é o objeto de padrões da mensagem.
    const url = new URL(env.SMTP_URL);
    const seguro = url.protocol === 'smtps:';

    this.transporter = createTransport({
      host: url.hostname,
      port: Number(url.port || (seguro ? 465 : 587)),
      secure: seguro,
      auth: url.username
        ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
        : undefined,
      // O servidor de dev (Mailpit) não tem TLS; produção exige STARTTLS e certificado válido.
      requireTLS: this.config.isProduction,
      tls: { rejectUnauthorized: this.config.isProduction },
      // Pool de conexões: uma rodada de alertas manda dezenas de mensagens seguidas, e abrir uma
      // conexão SMTP por mensagem custa mais que compor todas elas (doc 18 §4, SLO de entrega).
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.transporter.close();
  }

  /**
   * Envia e devolve se conseguiu. Não lança: um convite que falha no SMTP não pode derrubar a
   * requisição que o criou — o registro fica no banco e pode ser reenviado.
   */
  async send(message: MailMessage): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      // Assunto e destinatário bastam para operar; corpo nunca vai ao log (tem token dentro).
      this.logger.info({ event: 'mail_sent', subject: message.subject }, 'mail_sent');
      return true;
    } catch (error) {
      // Código e mensagem do driver explicitamente: é o que diz se foi DNS, recusa ou auth.
      const details = error as { code?: string; message?: string };
      this.logger.error(
        {
          event: 'mail_failed',
          subject: message.subject,
          code: details?.code,
          reason: details?.message,
        },
        'mail_failed',
      );
      return false;
    }
  }
}
