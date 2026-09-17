/**
 * Catálogo de domínios de sincronização (doc 14 §2).
 *
 * Vive no pacote compartilhado porque três lados precisam concordar sobre o mesmo nome: o worker
 * que executa, a tabela de watermarks que registra e o painel que mostra. Nome divergente aqui
 * vira "domínio que nunca sincroniza" sem ninguém notar.
 */
export const SYNC_DOMAINS = [
  'health',
  'dimensoes',
  'produtos',
  'vendas_hoje',
  'vendas_dia',
  'resumo_filial',
  'financeiro',
  'compras',
  'previsao',
  'backfill',
] as const;

export type SyncDomain = (typeof SYNC_DOMAINS)[number];

export interface SyncDomainInfo {
  /** Rótulo curto para a UI — em português, como tudo que o usuário lê. */
  label: string;
  /** O que este domínio traz, na linguagem de quem opera a loja. */
  descricao: string;
  /** Cadência padrão em segundos (doc 14 §2); configurável por tenant depois. */
  cadenciaSegundos: number;
  /** Domínios com recorte por filial gravam uma marca d'água por filial. */
  porFilial: boolean;
  /** Quanto tempo sem sucesso antes de a UI chamar de atrasado (SLO do doc 18 §3). */
  sloAtrasoSegundos: number;
}

export const SYNC_DOMAIN_INFO: Record<SyncDomain, SyncDomainInfo> = {
  health: {
    label: 'Conexão',
    descricao: 'Confere token, versão do ERP e as rotas contratadas.',
    cadenciaSegundos: 600,
    porFilial: false,
    sloAtrasoSegundos: 1_800,
  },
  dimensoes: {
    label: 'Cadastros',
    descricao: 'Filiais, departamentos, marcas, classes, agrupamentos e unidades.',
    cadenciaSegundos: 86_400,
    porFilial: false,
    sloAtrasoSegundos: 172_800,
  },
  produtos: {
    label: 'Produtos',
    descricao: 'Cadastro, preço, custo e estoque — varredura incremental por data de alteração.',
    cadenciaSegundos: 1_800,
    porFilial: false,
    sloAtrasoSegundos: 7_200,
  },
  vendas_hoje: {
    label: 'Vendas de hoje',
    descricao: 'Cupons e formas de pagamento do dia corrente, ainda provisórios.',
    cadenciaSegundos: 300,
    porFilial: true,
    sloAtrasoSegundos: 900,
  },
  vendas_dia: {
    label: 'Vendas consolidadas',
    descricao: 'Dia fechado no ERP: substitui o provisório pelo definitivo.',
    cadenciaSegundos: 1_800,
    porFilial: true,
    sloAtrasoSegundos: 86_400,
  },
  resumo_filial: {
    label: 'Resumo diário',
    descricao: 'Totais por filial e as marcas de fechamento que disparam a consolidação.',
    cadenciaSegundos: 1_800,
    porFilial: true,
    sloAtrasoSegundos: 86_400,
  },
  financeiro: {
    label: 'Financeiro',
    descricao: 'Contas a pagar e receber, despesas e transações de cartão.',
    // De hora em hora: o aging muda quando alguém baixa um título, não a cada minuto.
    cadenciaSegundos: 3_600,
    porFilial: false,
    sloAtrasoSegundos: 14_400,
  },
  compras: {
    label: 'Compras',
    descricao: 'Pedidos ao fornecedor e notas de entrada.',
    cadenciaSegundos: 3_600,
    porFilial: false,
    sloAtrasoSegundos: 14_400,
  },
  previsao: {
    label: 'Previsão de vendas',
    descricao: 'Meta do mês por filial e a curva diária que o ERP projeta.',
    // Uma vez por dia: a previsão é lançada pelo gerente e mexe raramente. Cadência curta aqui
    // só gastaria chamada no ERP da loja para reler o mesmo número.
    cadenciaSegundos: 86_400,
    porFilial: false,
    sloAtrasoSegundos: 172_800,
  },
  backfill: {
    label: 'Carga histórica',
    descricao: 'Traz o histórico contratado para trás, em fatias, sem atrapalhar o dia a dia.',
    // Cadência zero: backfill não tem agenda própria — ele é pedido e se reenfileira sozinho.
    cadenciaSegundos: 0,
    porFilial: false,
    sloAtrasoSegundos: 0,
  },
};

export function isSyncDomain(valor: string): valor is SyncDomain {
  return (SYNC_DOMAINS as readonly string[]).includes(valor);
}

/** Origem de uma execução — separa o que a cadência fez do que alguém pediu (doc 05 §2). */
export const SYNC_TRIGGERS = ['scheduler', 'backfill', 'manual'] as const;
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];
