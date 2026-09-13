import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { SgClient, SgError } from '../../../integration/sg';
import { type ContextoSync, type JobDeSync, type ResultadoSync } from '../sync.types';
import { VendasPersistencia } from './vendas.persistencia';

/**
 * Vendas do dia corrente (doc 14 §2, grupo "tempo real").
 *
 * Roda a cada 5 minutos por filial e regrava o dia inteiro — a API não oferece delta, e o dia de
 * uma loja cabe folgadamente numa transação. Os dados são **provisórios** (`is_realtime = true`)
 * até o fechamento: o ERP ainda recalcula estoque e cancelamentos depois que a loja baixa a porta.
 *
 * Depois do fechamento, `/vendas/hoje` pode responder vazio (doc 34 Q13, sem resposta). Por isso
 * um dia corrente que volta sem cupons **não apaga** o que já estava gravado: apagar por causa de
 * uma resposta ambígua seria transformar dúvida em perda de dado.
 */
@Injectable()
export class VendasHojeSync implements JobDeSync {
  readonly domain = 'vendas_hoje' as const;

  constructor(
    private readonly sg: SgClient,
    private readonly persistencia: VendasPersistencia,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VendasHojeSync.name);
  }

  async executar(contexto: ContextoSync): Promise<ResultadoSync> {
    const filialErpId = contexto.filialErpId;
    if (filialErpId === undefined) throw new Error('vendas_hoje exige filial');
    if (!contexto.data) throw new Error('vendas_hoje exige o dia corrente do tenant');

    const cupons = await this.sg.getVendasHoje(contexto.sg, { filial: filialErpId });
    const finalizadoras = await this.coletarFinalizadoras(contexto, filialErpId);

    if (cupons.itens.length === 0) {
      this.logger.debug(
        {
          event: 'sync_vendas_hoje_vazio',
          tenant_id: contexto.tenantId,
          filial: filialErpId,
          data: contexto.data,
        },
        'sync_vendas_hoje_vazio',
      );
      return {
        apiCalls: 2,
        pages: 2,
        invalid: cupons.invalidos + (finalizadoras?.invalidos ?? 0),
        watermarkTs: new Date(),
        observacao: 'sem cupons no dia corrente',
      };
    }

    const gravado = await this.persistencia.gravarDia({
      tenantId: contexto.tenantId,
      filialErpId,
      data: contexto.data,
      cupons: cupons.itens,
      finalizadoras: finalizadoras?.itens ?? [],
      isRealtime: true,
    });

    return {
      apiCalls: 2,
      pages: 2,
      items: gravado.cupons + gravado.itens + gravado.finalizadoras,
      invalid: cupons.invalidos + (finalizadoras?.invalidos ?? 0),
      // Dia corrente não fecha marca d'água de data: ele ainda vai mudar até o fechamento.
      watermarkTs: new Date(),
    };
  }

  /** Finalizadoras de hoje são desejáveis, não obrigatórias: sem elas o cupom ainda vale. */
  private async coletarFinalizadoras(contexto: ContextoSync, filial: number) {
    try {
      return await this.sg.getFinalizadoras(contexto.sg, { filial, hoje: true });
    } catch (erro) {
      if (erro instanceof SgError && erro.falha === 'rota_nao_contratada') return null;
      throw erro;
    }
  }
}
