import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';
import { OffboardingService, type ResultadoOffboarding } from '../retencao/offboarding.service';
import {
  RetencaoService,
  type PendenciaRetencao,
  type ResultadoPurga,
} from '../retencao/retencao.service';

interface PainelRetencao {
  politicas: ReturnType<RetencaoService['catalogo']>;
  pendencias: PendenciaRetencao[];
  /** Tenants já desligados que passaram da carência de 30 dias e serão purgados na próxima rodada. */
  offboardingPendente: Array<{ id: string; slug: string; deletedAt: string }>;
}

/**
 * Retenção e offboarding vistos de fora (E6-04).
 *
 * É área de plataforma, não de tenant: o que está aqui atravessa todos os clientes. A leitura
 * existe para o runbook — "prove que a retenção está sendo cumprida" se responde com um GET, e a
 * resposta certa é uma lista de zeros.
 */
@Controller('platform/retencao')
@UseGuards(PlatformAdminGuard)
export class RetencaoController {
  constructor(
    private readonly retencao: RetencaoService,
    private readonly offboarding: OffboardingService,
  ) {}

  @Get()
  async painel(): Promise<PainelRetencao> {
    const [pendencias, offboardingPendente] = await Promise.all([
      this.retencao.verificar(),
      this.offboarding.pendentes(),
    ]);

    return {
      politicas: this.retencao.catalogo(),
      pendencias,
      offboardingPendente: offboardingPendente.map((tenant) => ({
        id: tenant.id,
        slug: tenant.slug,
        deletedAt: tenant.deletedAt.toISOString(),
      })),
    };
  }

  /**
   * Antecipa a rodada diária. Não é um botão perigoso — apaga exatamente o que já deveria ter
   * sido apagado —, mas é auditado como tudo o mais nesta área.
   */
  @Post('executar')
  @HttpCode(200)
  async executar(): Promise<{
    purga: ResultadoPurga;
    offboarding: ResultadoOffboarding[];
    pendenciasApos: PendenciaRetencao[];
  }> {
    const purga = await this.retencao.purgar();
    const offboarding = await this.offboarding.purgarPendentes();
    // A verificação vem depois de propósito: é ela que prova que a purga cumpriu o catálogo.
    const pendenciasApos = await this.retencao.verificar();

    return { purga, offboarding, pendenciasApos };
  }
}
