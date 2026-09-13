import { Injectable } from '@nestjs/common';
import { SYNC_DOMAIN_INFO, type SyncDomain } from '@dashsgs/shared';
import { TenantDatabase } from '../../common/tenant';
import { type Frescor } from './dashboard.types';

/**
 * Frescor do dado exibido (doc 15 §9 / doc 16 §3).
 *
 * Todo número do dashboard vem acompanhado de "quando isso chegou". Não é enfeite: o ERP do
 * cliente pode estar fora do ar há horas, e um painel que mostra o número de ontem como se fosse
 * de agora é pior do que um painel que admite estar atrasado.
 *
 * Quando o recorte pega várias filiais, vale o **pior** caso: se uma loja não sincroniza desde
 * ontem, o total da rede está errado — mesmo que as outras quatro estejam em dia.
 */
@Injectable()
export class FrescorService {
  constructor(private readonly tenantDb: TenantDatabase) {}

  async de(
    tenantId: string,
    domain: SyncDomain,
    filiais: number[] | null,
    opcoes: { provisorio?: boolean } = {},
  ): Promise<Frescor> {
    const marcas = await this.tenantDb.run(tenantId, (tx) =>
      tx.syncWatermark.findMany({
        where: {
          domain,
          ...(filiais ? { filialErpId: { in: filiais } } : {}),
        },
        select: { lastSuccessAt: true },
      }),
    );

    const provisorio = opcoes.provisorio ?? false;

    if (marcas.length === 0) {
      // Nunca sincronizou: "atrasado" é a resposta honesta, e a tela mostra o estado vazio.
      return { atualizadoEm: null, atrasado: true, provisorio };
    }

    const sucessos = marcas.map((marca) => marca.lastSuccessAt?.getTime() ?? 0);
    const pior = Math.min(...sucessos);

    if (pior === 0) return { atualizadoEm: null, atrasado: true, provisorio };

    const slo = SYNC_DOMAIN_INFO[domain].sloAtrasoSegundos;
    const atrasoSegundos = Math.round((Date.now() - pior) / 1_000);

    return {
      atualizadoEm: new Date(pior).toISOString(),
      atrasado: slo > 0 && atrasoSegundos > slo,
      provisorio,
    };
  }
}
