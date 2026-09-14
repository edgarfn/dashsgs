/**
 * Catálogo de alertas (doc 15 §8).
 *
 * Vive no pacote compartilhado porque três lados precisam concordar: o motor que avalia, a tela
 * que lista e o e-mail que sai. Tipo novo aqui é contrato novo nos três.
 */

export const ALERT_TYPES = [
  'ruptura_curva_a',
  'estoque_negativo',
  'divergencia_fechamento',
  'queda_de_venda',
  'integracao_parada',
  'vencimento_proximo',
  'perda_anormal',
  'meta_em_risco',
  'conta_a_vencer',
  'cartao_nao_conciliado',
] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_SEVERITIES = ['critica', 'alta', 'media', 'baixa'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** Quem recebe o e-mail. Nem todo alerta é para a mesma pessoa (doc 15 §8). */
export const ALERT_AUDIENCES = ['operacao', 'administracao'] as const;
export type AlertAudience = (typeof ALERT_AUDIENCES)[number];

export interface AlertTypeInfo {
  label: string;
  /** O que a regra observa, na linguagem de quem opera a loja. */
  descricao: string;
  severidadePadrao: AlertSeverity;
  /** Parâmetros ajustáveis com seus valores padrão (doc 15 §8 "condição default"). */
  parametrosPadrao: Record<string, number>;
  audienciaPadrao: AlertAudience;
  /** `false` enquanto o domínio de sync que alimenta a regra não existir. */
  disponivel: boolean;
  /** Motivo da indisponibilidade — a tela mostra em vez de esconder a regra. */
  dependencia?: string;
}

export const ALERT_TYPE_INFO: Record<AlertType, AlertTypeInfo> = {
  ruptura_curva_a: {
    label: 'Ruptura de item curva A',
    descricao: 'Produto de maior giro com estoque abaixo do mínimo — venda que se perde hoje.',
    severidadePadrao: 'alta',
    parametrosPadrao: { minimoDeItens: 1 },
    audienciaPadrao: 'operacao',
    disponivel: true,
  },
  estoque_negativo: {
    label: 'Estoque negativo',
    descricao: 'Itens com saldo abaixo de zero — normalmente venda sem entrada lançada.',
    severidadePadrao: 'media',
    parametrosPadrao: { minimoDeItens: 1 },
    audienciaPadrao: 'operacao',
    disponivel: true,
  },
  divergencia_fechamento: {
    label: 'Divergência de fechamento',
    descricao:
      'O ERP apontou divergência no dia, ou a venda diária não foi gerada até o horário limite.',
    severidadePadrao: 'alta',
    parametrosPadrao: { horaLimite: 10 },
    audienciaPadrao: 'operacao',
    disponivel: true,
  },
  queda_de_venda: {
    label: 'Queda de venda',
    descricao:
      'Venda de hoje abaixo do esperado para o mesmo dia da semana, comparada às 4 semanas anteriores.',
    severidadePadrao: 'media',
    parametrosPadrao: { percentualMinimo: 70, horaDeCorte: 18 },
    audienciaPadrao: 'operacao',
    disponivel: true,
  },
  integracao_parada: {
    label: 'Integração parada',
    descricao: 'A sincronização com o ERP falhou ou está atrasada — os painéis vão congelar.',
    severidadePadrao: 'critica',
    parametrosPadrao: { atrasoMinutos: 60 },
    audienciaPadrao: 'administracao',
    disponivel: true,
  },
  vencimento_proximo: {
    label: 'Vencimento próximo',
    descricao: 'Lotes vencendo dentro do prazo configurado.',
    severidadePadrao: 'alta',
    parametrosPadrao: { dias: 7 },
    audienciaPadrao: 'operacao',
    disponivel: false,
    dependencia: 'sincronização de vencimentos (E5-10)',
  },
  perda_anormal: {
    label: 'Perda anormal',
    descricao: 'Perda do dia acima do padrão histórico da filial.',
    severidadePadrao: 'alta',
    parametrosPadrao: { desviosPadrao: 2 },
    audienciaPadrao: 'operacao',
    disponivel: false,
    dependencia: 'sincronização de perdas (E5-10)',
  },
  meta_em_risco: {
    label: 'Meta em risco',
    descricao: 'Projeção do mês abaixo da meta prevista.',
    severidadePadrao: 'media',
    parametrosPadrao: { percentualMinimo: 90, diaDoMes: 15 },
    audienciaPadrao: 'operacao',
    disponivel: false,
    dependencia: 'sincronização da previsão de vendas (E5-11)',
  },
  conta_a_vencer: {
    label: 'Conta a vencer',
    descricao: 'Parcelas a pagar vencendo nos próximos dias acima do limiar.',
    severidadePadrao: 'media',
    parametrosPadrao: { dias: 3, valorMinimo: 0 },
    audienciaPadrao: 'administracao',
    disponivel: false,
    dependencia: 'sincronização financeira (E5-09)',
  },
  cartao_nao_conciliado: {
    label: 'Cartão não conciliado',
    descricao: 'Transações de cartão sem baixa depois do prazo.',
    severidadePadrao: 'media',
    parametrosPadrao: { dias: 7 },
    audienciaPadrao: 'administracao',
    disponivel: false,
    dependencia: 'sincronização financeira (E5-09)',
  },
};

export const SEVERIDADE_LABEL: Record<AlertSeverity, string> = {
  critica: 'crítica',
  alta: 'alta',
  media: 'média',
  baixa: 'baixa',
};

/** Ordem de exibição: o que exige ação primeiro aparece primeiro. */
export const SEVERIDADE_PESO: Record<AlertSeverity, number> = {
  critica: 0,
  alta: 1,
  media: 2,
  baixa: 3,
};

export function isAlertType(valor: string): valor is AlertType {
  return (ALERT_TYPES as readonly string[]).includes(valor);
}

/** Tipos que o motor consegue avaliar hoje — os demais aguardam o sync correspondente. */
export const ALERT_TYPES_DISPONIVEIS = ALERT_TYPES.filter(
  (tipo) => ALERT_TYPE_INFO[tipo].disponivel,
);
