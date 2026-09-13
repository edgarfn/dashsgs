import { type BaseDeCusto } from './dto/dashboard.dto';

/** Frescor exibido em toda tela (doc 15 §9 / doc 16 §3): o dado é de quando, e é provisório? */
export interface Frescor {
  /** Último sucesso do domínio que alimenta este número. */
  atualizadoEm: string | null;
  /** `true` quando passou do SLO do domínio — a tela avisa em vez de fingir que está fresco. */
  atrasado: boolean;
  /** Dia corrente é provisório até o ERP fechar (doc 14 §7). */
  provisorio: boolean;
}

export interface VendaPorFilial {
  filialErpId: number;
  nome: string;
  venda: number;
  cupons: number;
  ticketMedio: number;
}

export interface PontoDaCurva {
  hora: number;
  valor: number;
  cupons: number;
  /** Média da mesma hora nas quatro semanas anteriores, no mesmo dia da semana. */
  mediaHistorica: number | null;
}

export interface ResumoDoDia {
  data: string;
  venda: number;
  cupons: number;
  ticketMedio: number;
  porFilial: VendaPorFilial[];
  curva: PontoDaCurva[];
  frescor: Frescor;
}

export interface FechamentoFilial {
  filialErpId: number;
  nome: string;
  data: string | null;
  atualizouEstoque: boolean;
  gerouVendasDiaria: boolean;
  exportouVendas: boolean;
  possuiDivergencia: boolean;
}

export interface DiaConsolidado {
  data: string | null;
  venda: number;
  clientes: number | null;
  ticketMedio: number | null;
  /** Margem só para manager+ (doc 15 §1); os demais recebem `null` e a tela explica. */
  margemPct: number | null;
  baseDeCusto: BaseDeCusto;
  /** Mesmo dia da semana anterior, para comparação honesta (sábado com sábado). */
  vendaSemanaAnterior: number | null;
  variacaoPct: number | null;
  frescor: Frescor;
}

export interface HomeView {
  hoje: ResumoDoDia;
  consolidado: DiaConsolidado;
  fechamento: FechamentoFilial[];
  /** `true` quando nenhum dado ainda chegou — a tela mostra o estado vazio explicativo. */
  semDados: boolean;
}

export interface CupomView {
  filialErpId: number;
  filialNome: string;
  data: string;
  caixa: number;
  cupom: number;
  horario: string | null;
  itens: number;
  valorTotal: number;
  desconto: number;
  cancelada: boolean;
  identificada: boolean;
  vendedorErpId: number | null;
  formas: string[];
}

export interface VendasDiaView {
  data: string;
  totais: {
    venda: number;
    cupons: number;
    ticketMedio: number;
    itensPorCupom: number;
    desconto: number;
    canceladas: number;
    valorCancelado: number;
  };
  formasDePagamento: Array<{ especie: string; valor: number; participacaoPct: number }>;
  cupons: CupomView[];
  paginacao: { pagina: number; itensPorPagina: number; total: number; paginas: number };
  frescor: Frescor;
}

export interface ComparativoView {
  periodo: { de: string; ate: string; dias: number };
  totais: {
    venda: number;
    clientes: number;
    ticketMedio: number;
    margemPct: number | null;
    baseDeCusto: BaseDeCusto;
  };
  serie: Array<{ data: string; venda: number; clientes: number; margemPct: number | null }>;
  porFilial: Array<{
    filialErpId: number;
    nome: string;
    venda: number;
    clientes: number;
    participacaoPct: number;
  }>;
  porDepartamento: Array<{
    dep1ErpId: string;
    nome: string;
    venda: number;
    quantidade: number;
    margemPct: number | null;
  }>;
  porDiaDaSemana: Array<{ diaDaSemana: number; venda: number; media: number }>;
  frescor: Frescor;
}

export interface ProdutoEstoqueView {
  erpId: number;
  descricao: string;
  filialErpId: number;
  filialNome: string;
  curvaAbc: string | null;
  estoqueAtual: number;
  estoqueMinimo: number;
  estoqueMaximo: number | null;
  vendaMediaDiaria: number;
  /** Dias de estoque no ritmo atual de venda; `null` quando o produto não vende. */
  coberturaDias: number | null;
  precoVenda: number | null;
  departamento: string | null;
}

export interface EstoqueView {
  situacao: 'ruptura' | 'negativo' | 'excesso';
  contagens: { ruptura: number; negativo: number; excesso: number; curvaAEmRuptura: number };
  produtos: ProdutoEstoqueView[];
  paginacao: { pagina: number; itensPorPagina: number; total: number; paginas: number };
  frescor: Frescor;
}
