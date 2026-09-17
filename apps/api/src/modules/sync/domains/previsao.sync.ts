import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { SgClient, SgError } from '../../../integration/sg';
import { TenantDatabase } from '../../../common/tenant';
import { type Coluna, upsertLote } from '../upsert-lote';
import { type ContextoSync, type JobDeSync, type ResultadoSync } from '../sync.types';

/**
 * Previsão de vendas: a meta do mês e a curva diária (E5-11 / doc 15 §7).
 *
 * Duas diferenças em relação a todos os outros domínios, e as duas vêm da natureza do dado:
 *
 * - **A janela é o mês, não um intervalo de dias.** Previsão é lançada por competência; buscar
 *   "os últimos 45 dias" não significaria nada aqui. Sincronizamos o mês corrente e o próximo,
 *   que é o horizonte que a loja tem lançado (doc 31 E5-11).
 * - **A curva diária é opcional.** Nem toda instalação a preenche, e a rota pode nem estar no
 *   contrato do tenant. Quando ela falta, a tela cai na projeção proporcional e **diz isso**;
 *   quando existe, a projeção segue a curva real — que é a diferença entre acusar atraso de
 *   verdade e acusar atraso toda segunda-feira, porque sábado vendeu mais.
 */
const COLUNAS_PREVISAO: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'filial_erp_id', tipo: 'int' },
  { nome: 'competencia', tipo: 'date' },
  { nome: 'previsao_venda', tipo: 'numeric' },
  { nome: 'previsao_lucro', tipo: 'numeric' },
  { nome: 'dias_uteis', tipo: 'int' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

const COLUNAS_DIARIA: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'filial_erp_id', tipo: 'int' },
  { nome: 'data', tipo: 'date' },
  { nome: 'previsao_venda', tipo: 'numeric' },
  { nome: 'synced_at', tipo: 'timestamptz' },
];

@Injectable()
export class PrevisaoSync implements JobDeSync {
  readonly domain = 'previsao' as const;

  constructor(
    private readonly sg: SgClient,
    private readonly tenantDb: TenantDatabase,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PrevisaoSync.name);
  }

  async executar(contexto: ContextoSync): Promise<ResultadoSync> {
    if (!contexto.data) throw new Error('previsão exige o dia corrente do tenant');

    const agora = new Date();
    const competencias = [mesDe(contexto.data), proximoMes(mesDe(contexto.data))];

    let items = 0;
    let invalid = 0;
    let apiCalls = 0;
    const filiais = new Set<number>();

    for (const { ano, mes } of competencias) {
      const mensal = await this.mensal(contexto, ano, mes, agora);
      items += mensal.items ?? 0;
      invalid += mensal.invalid ?? 0;
      apiCalls += mensal.apiCalls ?? 0;
      for (const filial of mensal.filiais) filiais.add(filial);
    }

    // A curva diária é buscada por filial — é assim que a rota funciona (doc 03). Só pedimos
    // para as filiais que de fato têm meta: sem meta, a curva não tem a que servir.
    for (const { ano, mes } of competencias) {
      for (const filial of filiais) {
        const diaria = await this.diaria(contexto, filial, ano, mes, agora);
        items += diaria.items ?? 0;
        invalid += diaria.invalid ?? 0;
        apiCalls += diaria.apiCalls ?? 0;
      }
    }

    return {
      items,
      invalid,
      apiCalls,
      pages: apiCalls,
      // Marca pelo instante: o domínio não anda por dia fechado, e sim por varredura completa.
      watermarkTs: agora,
    };
  }

  private async mensal(
    contexto: ContextoSync,
    ano: number,
    mes: number,
    agora: Date,
  ): Promise<ResultadoSync & { filiais: number[] }> {
    const resultado = await this.comTolerancia('previsão mensal', async () => {
      const coleta = await this.sg.getPrevisaoVendas(contexto.sg, { ano, mes });

      const items = await this.tenantDb.run(contexto.tenantId, (tx) =>
        upsertLote(
          tx,
          {
            tabela: 'erp_previsao_vendas',
            colunas: COLUNAS_PREVISAO,
            chave: ['tenant_id', 'filial_erp_id', 'competencia'],
          },
          coleta.itens.map((previsao) => ({
            tenant_id: contexto.tenantId,
            filial_erp_id: previsao.filialErpId,
            competencia: previsao.competencia,
            previsao_venda: previsao.previsaoVenda,
            previsao_lucro: previsao.previsaoLucro,
            dias_uteis: previsao.diasUteis,
            synced_at: agora,
          })),
        ),
      );

      return {
        items,
        invalid: coleta.invalidos,
        apiCalls: coleta.paginas ?? 1,
        filiais: [...new Set(coleta.itens.map((previsao) => previsao.filialErpId as number))],
      };
    });

    return resultado ?? { filiais: [] };
  }

  private async diaria(
    contexto: ContextoSync,
    filial: number,
    ano: number,
    mes: number,
    agora: Date,
  ): Promise<ResultadoSync> {
    const resultado = await this.comTolerancia('previsão diária', async () => {
      const coleta = await this.sg.getPrevisaoVendasDiaria(contexto.sg, { filial, ano, mes });

      const items = await this.tenantDb.run(contexto.tenantId, (tx) =>
        upsertLote(
          tx,
          {
            tabela: 'erp_previsao_vendas_diaria',
            colunas: COLUNAS_DIARIA,
            chave: ['tenant_id', 'filial_erp_id', 'data'],
          },
          coleta.itens.map((previsao) => ({
            tenant_id: contexto.tenantId,
            filial_erp_id: previsao.filialErpId,
            data: previsao.data,
            previsao_venda: previsao.previsaoVenda,
            synced_at: agora,
          })),
        ),
      );

      return { items, invalid: coleta.invalidos, apiCalls: coleta.paginas ?? 1 };
    });

    return resultado ?? {};
  }

  /**
   * Rota fora do contrato do tenant não é falha de sincronização.
   *
   * Vale mais aqui do que em qualquer outro domínio: previsão é módulo opcional do ERP, e uma
   * instalação que não o usa não pode ver o painel de sincronização vermelho para sempre por
   * causa de um recurso que ela não contratou.
   */
  private async comTolerancia<T>(rotulo: string, executar: () => Promise<T>): Promise<T | null> {
    try {
      return await executar();
    } catch (erro) {
      if (
        erro instanceof SgError &&
        (erro.falha === 'rota_nao_contratada' || erro.falha === 'nao_encontrado')
      ) {
        this.logger.info({ event: 'previsao_sem_contrato', recurso: rotulo }, 'previsao');
        return null;
      }
      throw erro;
    }
  }
}

function mesDe(dia: string): { ano: number; mes: number } {
  return { ano: Number(dia.slice(0, 4)), mes: Number(dia.slice(5, 7)) };
}

function proximoMes({ ano, mes }: { ano: number; mes: number }): { ano: number; mes: number } {
  return mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
}
