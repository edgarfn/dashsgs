import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';

/**
 * Sessão ativa é estado do banco, não do processo (doc 18 §2 "Aplicação").
 *
 * Contadores podem ser somados entre réplicas; gauge de estado compartilhado, não. Se cada
 * réplica de API publicasse `sessions_active`, o painel teria N séries com o mesmo número e
 * qualquer `sum()` responderia N× a verdade. Por isso a amostragem mora no worker, que é único
 * por instalação — e por isso ela lê o banco em vez de contar o que passou por este processo.
 *
 * Fora do contexto de tenant de propósito: a pergunta é da plataforma ("quantos estão logados
 * agora?"), não de um cliente. Só o total sai daqui — tenant como rótulo transformaria a
 * métrica em um mapa de quem trabalha a que horas, e isso é dado de cliente (doc 10 §3).
 */
@Injectable()
export class PlataformaMetricsSampler implements OnModuleInit, OnApplicationShutdown {
  /** Sessão dura horas; amostrar de minuto em minuto é resolução de sobra e custo nenhum. */
  private static readonly INTERVALO_MS = 60_000;

  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlataformaMetricsSampler.name);
  }

  onModuleInit(): void {
    void this.amostrar();
    this.timer = setInterval(() => void this.amostrar(), PlataformaMetricsSampler.INTERVALO_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async amostrar(): Promise<void> {
    try {
      const agora = new Date();

      const ativas = await this.prisma.session.count({
        where: { revokedAt: null, expiresAt: { gt: agora } },
      });
      this.metrics.sessionsActive.set(ativas);

      await this.amostrarBreakGlass(agora);
    } catch {
      // Banco fora do ar já acende `/readyz` e o alerta de dependência; a amostragem falhar de
      // novo no log só aumentaria o ruído de um incidente que já tem dono.
    }
  }

  /**
   * Break-glass aberto (E9-03). Duas séries e não uma: a contagem responde "há acesso
   * excepcional agora?" e a idade responde "há quanto tempo?". O alerta do doc 18 §5 precisa da
   * segunda — o teto do serviço é 8 h, e uma concessão mais velha que isso é invariante quebrada.
   */
  private async amostrarBreakGlass(agora: Date): Promise<void> {
    // Concessão ativa dura no máximo 8 h e é excepcional por definição: a lista inteira cabe na
    // memória, e trazê-la de uma vez evita duas idas ao banco para responder a mesma pergunta.
    const ativas = await this.prisma.breakGlassGrant.findMany({
      where: { approvedAt: { not: null }, revokedAt: null, expiresAt: { gt: agora } },
      select: { approvedAt: true },
      orderBy: { approvedAt: 'asc' },
    });

    this.metrics.breakglassGrantsActive.set(ativas.length);

    // Zero quando não há nenhuma: gauge sem valor some da raspagem, e regra de alerta sobre
    // série ausente é a que não dispara no dia em que importa.
    const maisAntiga = ativas[0]?.approvedAt;
    this.metrics.breakglassOldestGrantSeconds.set(
      maisAntiga ? Math.max(0, Math.floor((agora.getTime() - maisAntiga.getTime()) / 1_000)) : 0,
    );
  }
}
