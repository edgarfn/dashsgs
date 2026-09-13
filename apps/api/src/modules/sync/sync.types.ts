import { type SyncDomain, type SyncTrigger } from '@dashsgs/shared';
import { type SgCallContext } from '../../integration/sg';

// As funções de data vivem em common/datas.ts desde a Fase 7 (o dashboard usa as mesmas).
// Reexportadas aqui para que os jobs continuem importando de um lugar só.
export { diaEm, diferencaEmDias, somarDias } from '../../common/datas';

/** Tudo que um job de domínio precisa saber para rodar uma vez. */
export interface ContextoSync {
  tenantId: string;
  /** Conexão + credencial do tenant, já resolvidas (cofre + token manager). */
  sg: SgCallContext;
  /** Domínios com recorte por filial recebem a filial; os demais, undefined. */
  filialErpId?: number;
  /** Dia alvo (`YYYY-MM-DD`) para domínios por data; ausente = o job decide pela marca d'água. */
  data?: string;
  /**
   * Período explícito, usado pelo backfill: sem ele, o job escolheria a janela pela marca d'água
   * — que no backfill aponta justamente para o presente, não para a fatia antiga que se quer.
   */
  periodo?: { inicio: string; fim: string };
  trigger: SyncTrigger;
}

/** O que o job devolve: contadores para o histórico e a nova posição da marca d'água. */
export interface ResultadoSync {
  pages?: number;
  items?: number;
  apiCalls?: number;
  invalid?: number;
  /** Só avança em sucesso (doc 14 §1). */
  watermarkDate?: string | null;
  watermarkTs?: Date | null;
  cursor?: Record<string, unknown> | null;
  /** Mensagem curta para o painel quando o job decidiu não fazer nada. */
  observacao?: string;
}

export interface JobDeSync {
  readonly domain: SyncDomain;
  executar(contexto: ContextoSync): Promise<ResultadoSync>;
}

/** Soma resultados parciais (uma filial, uma fatia) num resultado só. */
export function somarResultados(partes: ResultadoSync[]): ResultadoSync {
  return partes.reduce<ResultadoSync>(
    (total, parte) => ({
      pages: (total.pages ?? 0) + (parte.pages ?? 0),
      items: (total.items ?? 0) + (parte.items ?? 0),
      apiCalls: (total.apiCalls ?? 0) + (parte.apiCalls ?? 0),
      invalid: (total.invalid ?? 0) + (parte.invalid ?? 0),
    }),
    {},
  );
}
