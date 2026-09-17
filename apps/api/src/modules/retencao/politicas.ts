/**
 * Catálogo de retenção (doc 10 §2 / E6-04).
 *
 * A matriz "DADO → ciclo de vida" do doc 10 é um compromisso com o cliente e com a LGPD; enquanto
 * ela viver só em prosa, o banco guarda tudo para sempre. Aqui ela vira uma tabela executável:
 * cada linha diz qual tabela, por qual coluna de data e por quanto tempo — e é a mesma lista que
 * a purga apaga e que a verificação confere. As duas não podem divergir porque são a mesma.
 *
 * O que NÃO está aqui também é decisão: tabela de cadastro (produtos, filiais, dimensões) espelha
 * o ERP e vale enquanto o contrato existir — quem apaga isso é o offboarding, não o relógio.
 */

/** De onde sai o prazo. Meses e dias não são intercambiáveis: 26 meses é calendário, não 790 dias. */
export type Prazo =
  | { dias: number }
  | { meses: number }
  /** Detalhe de vendas, configurável por contrato (`app_tenants.retention_sales_months`). */
  | { mesesDoTenant: true };

export interface PoliticaRetencao {
  /** Identificador estável: entra em métrica, log e relatório. Mudar quebra série histórica. */
  id: string;
  tabela: string;
  /** Coluna que decide a idade da linha. Linha com a coluna nula nunca vence — ver nota abaixo. */
  coluna: string;
  tipoColuna: 'date' | 'timestamptz';
  /**
   * `identidade`: tabela sem `tenant_id` ou com RLS de identidade — purga uma vez, global.
   * `tenant`: RLS estrita — a purga roda dentro do contexto de cada tenant, um por vez.
   */
  escopo: 'identidade' | 'tenant';
  prazo: Prazo;
  /**
   * Quando existe, a exclusão passa por esta função do banco em vez de um DELETE direto.
   * É o caso da auditoria: append-only por trigger, com uma única exceção — o vencimento.
   */
  funcaoPurga?: string;
  origem: string;
  motivo: string;
}

const CINCO_ANOS: Prazo = { meses: 60 };

/**
 * Nulos: `WHERE coluna < corte` ignora linha com data nula, e isso é proposital. Não dá para
 * provar que venceu o que não tem data; o caminho dessas linhas é o offboarding.
 */
export const POLITICAS: readonly PoliticaRetencao[] = [
  {
    id: 'sessoes',
    tabela: 'app_sessions',
    coluna: 'expires_at',
    tipoColuna: 'timestamptz',
    escopo: 'identidade',
    prazo: { dias: 90 },
    origem: 'doc 10 §2',
    motivo: 'IP e user-agent servem para investigar incidente recente, não para arquivo.',
  },
  {
    id: 'tokens_de_senha',
    tabela: 'app_password_resets',
    coluna: 'created_at',
    tipoColuna: 'timestamptz',
    escopo: 'identidade',
    prazo: { dias: 30 },
    origem: 'doc 10 §4 (minimização)',
    motivo: 'O token vale uma hora; o registro só interessa enquanto houver o que investigar.',
  },
  {
    id: 'convites',
    tabela: 'app_invites',
    coluna: 'created_at',
    tipoColuna: 'timestamptz',
    escopo: 'identidade',
    prazo: { dias: 90 },
    origem: 'doc 10 §4 (minimização)',
    motivo: 'Convite guarda e-mail de quem talvez nunca tenha virado usuário.',
  },
  {
    id: 'usuarios_desligados',
    tabela: 'app_users',
    coluna: 'deleted_at',
    tipoColuna: 'timestamptz',
    escopo: 'identidade',
    prazo: { meses: 6 },
    origem: 'doc 10 §2',
    motivo:
      'Conta desligada some seis meses depois. Quem marca `deleted_at` é o offboarding, ao ' +
      'deixar o usuário sem nenhum vínculo — até lá a conta continua servindo outros tenants.',
  },
  {
    id: 'auditoria',
    tabela: 'app_audit_log',
    coluna: 'created_at',
    tipoColuna: 'timestamptz',
    escopo: 'identidade',
    prazo: CINCO_ANOS,
    funcaoPurga: 'app_purge_audit_log',
    origem: 'doc 10 §2',
    motivo: 'Accountability (art. 6º X). Append-only: só o vencimento abre exceção, e no banco.',
  },
  {
    id: 'chamadas_sg',
    tabela: 'sync_api_call_log',
    coluna: 'called_at',
    tipoColuna: 'timestamptz',
    escopo: 'tenant',
    prazo: { dias: 30 },
    origem: 'doc 10 §2',
    motivo: 'Contabilidade de capacidade; sem payload, sem valor histórico.',
  },
  {
    id: 'execucoes_sync',
    tabela: 'sync_job_runs',
    coluna: 'started_at',
    tipoColuna: 'timestamptz',
    escopo: 'tenant',
    prazo: { dias: 90 },
    origem: 'doc 18 §1 (log de segurança)',
    motivo: 'Histórico operacional: diagnostica a semana ruim, não o ano passado.',
  },
  {
    id: 'vendas_cupons',
    tabela: 'erp_vendas_cupons',
    coluna: 'data',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: { mesesDoTenant: true },
    origem: 'doc 10 §2',
    motivo: 'Detalhe de venda: 26 meses cobrem o comparativo anual com folga.',
  },
  {
    id: 'vendas_itens',
    tabela: 'erp_venda_itens',
    coluna: 'data',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: { mesesDoTenant: true },
    origem: 'doc 10 §2',
    motivo: 'Item de cupom é o maior volume do espelho — e o que envelhece mais rápido.',
  },
  {
    id: 'vendas_finalizadoras',
    tabela: 'erp_finalizadora_lancamentos',
    coluna: 'data',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: { mesesDoTenant: true },
    origem: 'doc 10 §2',
    motivo: 'Acompanha o cupom: mesma retenção, senão sobra pagamento sem venda.',
  },
  {
    id: 'resumo_filial',
    tabela: 'erp_filial_venda_resumo',
    coluna: 'data',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: CINCO_ANOS,
    origem: 'doc 10 §2 (agregados)',
    motivo: 'É o agregado que sustenta o comparativo de longo prazo depois que o detalhe sai.',
  },
  {
    id: 'agg_vendas_hora',
    tabela: 'agg_vendas_hora',
    coluna: 'data',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: CINCO_ANOS,
    origem: 'doc 10 §2 (agregados)',
    motivo: 'KPI de longo prazo, sem dado de cupom.',
  },
  {
    id: 'agg_vendas_dia_dep',
    tabela: 'agg_vendas_dia_dep',
    coluna: 'data',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: CINCO_ANOS,
    origem: 'doc 10 §2 (agregados)',
    motivo: 'Idem, por departamento.',
  },
  {
    id: 'contas_pagar',
    tabela: 'erp_contas_pagar',
    coluna: 'data_emissao',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: CINCO_ANOS,
    origem: 'doc 10 §2',
    motivo: 'Prática fiscal brasileira. As parcelas caem junto, por cascata da FK.',
  },
  {
    id: 'contas_receber',
    tabela: 'erp_contas_receber',
    coluna: 'data_emissao',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: CINCO_ANOS,
    origem: 'doc 10 §2',
    motivo: 'Idem contas a pagar.',
  },
  {
    id: 'despesas',
    tabela: 'erp_despesas',
    coluna: 'data_despesa',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: CINCO_ANOS,
    origem: 'doc 10 §2',
    motivo: 'Despesa é lançamento contábil: acompanha o prazo fiscal das contas.',
  },
  {
    id: 'cartoes',
    tabela: 'erp_cartao_vendas',
    coluna: 'data_venda',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: CINCO_ANOS,
    origem: 'doc 10 §2',
    motivo: 'Idem — e a conciliação de cartão é justamente o que se audita anos depois.',
  },
  {
    id: 'pedidos_compra',
    tabela: 'erp_pedidos_compra',
    coluna: 'data_pedido',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: CINCO_ANOS,
    origem: 'doc 10 §2 (extensão: compras acompanha o financeiro)',
    motivo: 'Pedido é a origem da nota de entrada, que é documento fiscal.',
  },
  {
    id: 'notas_entrada',
    tabela: 'erp_notas_entrada',
    coluna: 'data_entrada',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: CINCO_ANOS,
    origem: 'doc 10 §2 (extensão: compras acompanha o financeiro)',
    motivo: 'Documento fiscal de entrada.',
  },
  {
    id: 'previsao_vendas',
    tabela: 'erp_previsao_vendas',
    coluna: 'competencia',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: CINCO_ANOS,
    origem: 'doc 10 §2 (agregados)',
    motivo: 'Meta acompanha o resumo diário: comparar realizado com o previsto de anos atrás.',
  },
  {
    id: 'previsao_vendas_diaria',
    tabela: 'erp_previsao_vendas_diaria',
    coluna: 'data',
    tipoColuna: 'date',
    escopo: 'tenant',
    prazo: CINCO_ANOS,
    origem: 'doc 10 §2 (agregados)',
    motivo: 'A curva sem a meta do mês não responde nada; as duas vivem e vencem juntas.',
  },
  {
    id: 'alertas',
    tabela: 'app_alert_events',
    coluna: 'created_at',
    tipoColuna: 'timestamptz',
    escopo: 'tenant',
    prazo: { meses: 12 },
    origem: 'doc 15 §8 (decisão de produto, Fase 9)',
    motivo: 'Um ano permite comparar "como estava esta época no ano passado" e não mais que isso.',
  },
  {
    id: 'notificacoes',
    tabela: 'app_notifications',
    coluna: 'created_at',
    tipoColuna: 'timestamptz',
    escopo: 'tenant',
    prazo: { meses: 6 },
    origem: 'doc 15 §8 (decisão de produto, Fase 9)',
    motivo: 'Comprovante de envio: interessa enquanto alguém pode perguntar "não recebi".',
  },
] as const;

/** Data de corte: linha anterior a ela está vencida. */
export function calcularCorte(prazo: Prazo, agora: Date, mesesDeVendas: number): Date {
  const corte = new Date(agora.getTime());
  if ('dias' in prazo) {
    corte.setUTCDate(corte.getUTCDate() - prazo.dias);
    return corte;
  }
  // Meses são calendário: 26 meses atrás de 31/03 é 31/01, não "26 × 30 dias".
  corte.setUTCMonth(corte.getUTCMonth() - ('meses' in prazo ? prazo.meses : mesesDeVendas));
  return corte;
}

/** Descrição do prazo para o painel e para o log. */
export function descreverPrazo(prazo: Prazo, mesesDeVendas: number): string {
  if ('dias' in prazo) return `${prazo.dias} dias`;
  const meses = 'meses' in prazo ? prazo.meses : mesesDeVendas;
  return meses % 12 === 0 ? `${meses / 12} ano(s)` : `${meses} meses`;
}
