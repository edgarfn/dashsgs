import { Injectable } from '@nestjs/common';
import { SYNC_DOMAIN_INFO, SYNC_DOMAINS, type SyncDomain } from '@dashsgs/shared';
import { MetricsService } from '../../common/metrics/metrics.service';
import { TenantDatabase } from '../../common/tenant';
import { BackfillService, type ProgressoBackfill } from './backfill.service';
import { SyncRunService, type RegistroExecucao } from './sync-run.service';
import { WatermarkService } from './watermark.service';

export interface EstadoDominio {
  domain: SyncDomain;
  label: string;
  descricao: string;
  porFilial: boolean;
  /** Uma entrada por filial nos domínios com recorte; uma só nos demais. */
  escopos: Array<{
    filialErpId: number;
    filialNome: string | null;
    status: 'idle' | 'running' | 'error' | 'nunca';
    ultimoSucesso: string | null;
    atrasoSegundos: number | null;
    /** Atrasado = passou do SLO do domínio (doc 18 §3). */
    atrasado: boolean;
    watermarkDate: string | null;
    ultimoErro: string | null;
  }>;
}

export interface PainelSync {
  dominios: EstadoDominio[];
  execucoes: Array<Omit<RegistroExecucao, 'id'> & { id: string; filialNome: string | null }>;
  backfill: ProgressoBackfill;
  /** Frescor geral: o domínio essencial mais atrasado (doc 14 §7). */
  atrasoMaximoSegundos: number | null;
}

/**
 * Estado da sincronização para o painel do admin (E5-12 / doc 26 §Status).
 *
 * A pergunta que esta tela responde é sempre a mesma: **os números da minha loja estão
 * atualizados?** Por isso ela mostra frescor por domínio e por filial, e não um "ok" genérico —
 * um tenant pode estar com a filial 1 em dia e a filial 3 parada há dois dias.
 */
@Injectable()
export class SyncStatusService {
  constructor(
    private readonly watermarks: WatermarkService,
    private readonly runs: SyncRunService,
    private readonly backfill: BackfillService,
    private readonly tenantDb: TenantDatabase,
    private readonly metrics: MetricsService,
  ) {}

  async painel(tenantId: string): Promise<PainelSync> {
    const [marcas, execucoes, backfill, filiais] = await Promise.all([
      this.watermarks.listar(tenantId),
      this.runs.ultimas(tenantId, 20),
      this.backfill.progresso(tenantId),
      this.filiais(tenantId),
    ]);

    const agora = Date.now();
    const nomePorFilial = new Map(filiais.map((filial) => [filial.erpId, filial.nome]));
    let atrasoMaximo: number | null = null;

    const dominios: EstadoDominio[] = SYNC_DOMAINS.filter((domain) => domain !== 'backfill').map(
      (domain) => {
        const info = SYNC_DOMAIN_INFO[domain];
        const doDominio = marcas.filter((marca) => marca.domain === domain);

        // Domínio por filial sem marca nenhuma ainda aparece com as filiais conhecidas, em vez de
        // sumir da tela: "nunca sincronizou" é justamente o que o admin precisa ver.
        const escoposBase = info.porFilial ? filiais.map((filial) => filial.erpId) : [0];
        const escopos = escoposBase.map((filialErpId) => {
          const marca = doDominio.find((item) => item.filialErpId === filialErpId);
          const atrasoSegundos = marca?.lastSuccessAt
            ? Math.round((agora - marca.lastSuccessAt.getTime()) / 1_000)
            : null;

          const atrasado =
            info.sloAtrasoSegundos > 0 &&
            (atrasoSegundos === null || atrasoSegundos > info.sloAtrasoSegundos);

          if (atrasoSegundos !== null) {
            this.metrics.setSyncLag(tenantId, domain, atrasoSegundos);
            if (atrasoMaximo === null || atrasoSegundos > atrasoMaximo) {
              atrasoMaximo = atrasoSegundos;
            }
          }

          return {
            filialErpId,
            filialNome: nomePorFilial.get(filialErpId) ?? null,
            status: (marca?.status ?? 'nunca') as 'idle' | 'running' | 'error' | 'nunca',
            ultimoSucesso: marca?.lastSuccessAt?.toISOString() ?? null,
            atrasoSegundos,
            atrasado,
            watermarkDate: marca?.watermarkDate ?? null,
            ultimoErro: marca?.lastError ?? null,
          };
        });

        return {
          domain,
          label: info.label,
          descricao: info.descricao,
          porFilial: info.porFilial,
          escopos,
        };
      },
    );

    return {
      dominios,
      // `id` vira string: BigInt não sobrevive à serialização JSON.
      execucoes: execucoes.map((execucao) => ({
        ...execucao,
        id: execucao.id.toString(),
        filialNome:
          execucao.filialErpId === null ? null : (nomePorFilial.get(execucao.filialErpId) ?? null),
      })),
      backfill,
      atrasoMaximoSegundos: atrasoMaximo,
    };
  }

  private async filiais(tenantId: string): Promise<Array<{ erpId: number; nome: string }>> {
    const linhas = await this.tenantDb.run(tenantId, (tx) =>
      tx.erpFilial.findMany({
        where: { ativa: true },
        select: { erpId: true, nomeFantasia: true, razaoSocial: true },
        orderBy: { erpId: 'asc' },
      }),
    );

    return linhas.map((linha) => ({
      erpId: linha.erpId,
      nome: linha.nomeFantasia ?? linha.razaoSocial,
    }));
  }
}
