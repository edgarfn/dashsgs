import { Prisma } from '@prisma/client';
import { type AlertType } from '@dashsgs/shared';
import { type PrismaTransaction } from '../../common/prisma/prisma.service';
import { somarDias } from '../../common/datas';

/**
 * Avaliadores das regras de alerta (doc 15 §8).
 *
 * Cada avaliador é uma função pura sobre o espelho: recebe a transação já no contexto do tenant e
 * os parâmetros da regra, e devolve **ocorrências**. Quem transforma ocorrência em evento, decide
 * dedupe e dispara e-mail é o motor — assim uma regra nova é só mais uma função aqui.
 *
 * Duas escolhas atravessam todos eles:
 *
 * - **Agrupar por filial, não por item.** "37 itens de curva A em ruptura na Loja Centro" é uma
 *   mensagem que alguém age; 37 e-mails com um item cada é ruído que o cliente desliga.
 * - **A chave de dedupe carrega o dia.** O mesmo problema, no mesmo dia, é o mesmo alerta — é o
 *   "dedupe diário por chave" do doc 15 §8. No dia seguinte ele volta, porque continua doendo.
 */

export interface Ocorrencia {
  /** Filial afetada; `null` quando o alerta é da rede inteira (integração, por exemplo). */
  filialErpId: number | null;
  /** Identidade do problema no dia: mesma chave = mesmo alerta (doc 15 §8). */
  dedupeKey: string;
  /** Uma frase que cabe no assunto do e-mail e na linha do feed. */
  resumo: string;
  /** Contexto estruturado para a tela — contagens e ids, nunca PII (doc 10 §1). */
  payload: Record<string, unknown>;
}

export interface ContextoAvaliacao {
  tx: PrismaTransaction;
  tenantId: string;
  /** Hoje no fuso do tenant (`YYYY-MM-DD`). */
  hoje: string;
  /** Hora local do tenant (0–23) — regras com hora-limite dependem disto. */
  horaLocal: number;
  params: Record<string, number>;
}

export type Avaliador = (contexto: ContextoAvaliacao) => Promise<Ocorrencia[]>;

/** Nome legível da filial para a mensagem; o id sozinho não diz nada a quem lê. */
async function nomesDeFilial(tx: PrismaTransaction, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();

  const filiais = await tx.erpFilial.findMany({
    where: { erpId: { in: ids } },
    select: { erpId: true, nomeFantasia: true, razaoSocial: true },
  });

  return new Map(
    filiais.map((filial) => [filial.erpId, filial.nomeFantasia ?? filial.razaoSocial]),
  );
}

// ---------------------------------------------------------------- estoque
const ruptura: Avaliador = async ({ tx, hoje, params }) => {
  const minimo = params.minimoDeItens ?? 1;

  const linhas = await tx.$queryRaw<Array<{ filial_erp_id: number; itens: number }>>(Prisma.sql`
    SELECT filial_erp_id, COUNT(*)::int AS itens
    FROM erp_produtos
    WHERE ativo = true
      AND curva_abc = 'A'
      AND estoque_minimo > 0
      AND estoque_atual < estoque_minimo
    GROUP BY filial_erp_id
    HAVING COUNT(*) >= ${minimo}
    ORDER BY itens DESC`);

  const nomes = await nomesDeFilial(
    tx,
    linhas.map((linha) => linha.filial_erp_id),
  );

  return linhas.map((linha) => ({
    filialErpId: linha.filial_erp_id,
    dedupeKey: `${hoje}:${linha.filial_erp_id}`,
    resumo: `${linha.itens} ${linha.itens === 1 ? 'item' : 'itens'} de curva A em ruptura na ${nomes.get(linha.filial_erp_id) ?? `filial ${linha.filial_erp_id}`}`,
    payload: {
      itens: linha.itens,
      filial: nomes.get(linha.filial_erp_id) ?? null,
      link: `/estoque?situacao=ruptura&curva=A&filiais=${linha.filial_erp_id}`,
    },
  }));
};

const estoqueNegativo: Avaliador = async ({ tx, hoje, params }) => {
  const minimo = params.minimoDeItens ?? 1;

  const linhas = await tx.$queryRaw<Array<{ filial_erp_id: number; itens: number }>>(Prisma.sql`
    SELECT filial_erp_id, COUNT(*)::int AS itens
    FROM erp_produtos
    WHERE ativo = true AND estoque_atual < 0
    GROUP BY filial_erp_id
    HAVING COUNT(*) >= ${minimo}
    ORDER BY itens DESC`);

  const nomes = await nomesDeFilial(
    tx,
    linhas.map((linha) => linha.filial_erp_id),
  );

  return linhas.map((linha) => ({
    filialErpId: linha.filial_erp_id,
    dedupeKey: `${hoje}:${linha.filial_erp_id}`,
    resumo: `${linha.itens} ${linha.itens === 1 ? 'item' : 'itens'} com estoque negativo na ${nomes.get(linha.filial_erp_id) ?? `filial ${linha.filial_erp_id}`}`,
    payload: {
      itens: linha.itens,
      filial: nomes.get(linha.filial_erp_id) ?? null,
      link: `/estoque?situacao=negativo&filiais=${linha.filial_erp_id}`,
    },
  }));
};

// ---------------------------------------------------------------- fechamento
/**
 * Duas situações, um alerta: o ERP apontou divergência no dia anterior, **ou** passou da hora
 * limite e a venda diária não foi gerada. As duas significam a mesma coisa para quem opera —
 * o número do dia não é confiável ainda.
 */
const divergenciaFechamento: Avaliador = async ({ tx, hoje, horaLocal, params }) => {
  const ontem = somarDias(hoje, -1);
  const horaLimite = params.horaLimite ?? 10;

  const linhas = await tx.$queryRaw<
    Array<{ filial_erp_id: number; possui_divergencia: boolean; gerou_vendas_diaria: boolean }>
  >(Prisma.sql`
    SELECT filial_erp_id, possui_divergencia, gerou_vendas_diaria
    FROM erp_filial_venda_resumo
    WHERE data = ${ontem}::date
      AND (possui_divergencia = true OR gerou_vendas_diaria = false)`);

  const nomes = await nomesDeFilial(
    tx,
    linhas.map((linha) => linha.filial_erp_id),
  );

  return linhas
    .filter((linha) => linha.possui_divergencia || horaLocal >= horaLimite)
    .map((linha) => {
      const filial = nomes.get(linha.filial_erp_id) ?? `filial ${linha.filial_erp_id}`;
      const motivo = linha.possui_divergencia
        ? 'divergência apontada pelo ERP'
        : `venda diária não gerada até ${horaLimite}h`;

      return {
        filialErpId: linha.filial_erp_id,
        dedupeKey: `${ontem}:${linha.filial_erp_id}`,
        resumo: `Fechamento de ${ontem.split('-').reverse().join('/')} na ${filial}: ${motivo}`,
        payload: {
          data: ontem,
          filial,
          possuiDivergencia: linha.possui_divergencia,
          gerouVendasDiaria: linha.gerou_vendas_diaria,
          link: `/vendas?data=${ontem}&filiais=${linha.filial_erp_id}`,
        },
      };
    });
};

// ---------------------------------------------------------------- venda
/**
 * Queda de venda comparada ao **mesmo dia da semana** nas quatro semanas anteriores, e só depois
 * da hora de corte: às 9h da manhã qualquer loja está "abaixo da média do dia", e um alerta que
 * dispara todo dia cedo é um alerta que ninguém lê.
 */
const quedaDeVenda: Avaliador = async ({ tx, hoje, horaLocal, params }) => {
  const percentualMinimo = params.percentualMinimo ?? 70;
  const horaDeCorte = params.horaDeCorte ?? 18;

  if (horaLocal < horaDeCorte) return [];

  const referencias = [7, 14, 21, 28].map((dias) => somarDias(hoje, -dias));

  const linhas = await tx.$queryRaw<
    Array<{ filial_erp_id: number; hoje: number; media: number | null }>
  >(Prisma.sql`
    WITH atual AS (
      SELECT filial_erp_id, SUM(valor_total)::float8 AS venda
      FROM erp_vendas_cupons
      WHERE data = ${hoje}::date AND cancelada = false
      GROUP BY filial_erp_id
    ),
    historico AS (
      SELECT filial_erp_id, (SUM(valor) / 4)::float8 AS media
      FROM erp_filial_venda_resumo
      WHERE data IN (${Prisma.join(referencias.map((dia) => Prisma.sql`${dia}::date`))})
      GROUP BY filial_erp_id
    )
    SELECT a.filial_erp_id, a.venda AS hoje, h.media
    FROM atual a
    JOIN historico h ON h.filial_erp_id = a.filial_erp_id
    WHERE h.media > 0 AND a.venda < h.media * ${percentualMinimo} / 100.0`);

  const nomes = await nomesDeFilial(
    tx,
    linhas.map((linha) => linha.filial_erp_id),
  );

  return linhas.map((linha) => {
    const percentual = linha.media ? (Number(linha.hoje) / Number(linha.media)) * 100 : 0;
    const filial = nomes.get(linha.filial_erp_id) ?? `filial ${linha.filial_erp_id}`;

    return {
      filialErpId: linha.filial_erp_id,
      dedupeKey: `${hoje}:${linha.filial_erp_id}`,
      resumo: `Venda de hoje na ${filial} está em ${percentual.toFixed(0)}% da média deste dia da semana`,
      payload: {
        venda: Number(linha.hoje),
        media: Number(linha.media ?? 0),
        percentual: Number(percentual.toFixed(1)),
        filial,
        link: `/vendas?filiais=${linha.filial_erp_id}`,
      },
    };
  });
};

// ---------------------------------------------------------------- integração
/**
 * O alerta que o admin do tenant precisa ver antes do cliente ligar (E8-05).
 *
 * Repare que ele **não** depende da conexão estar de pé — ao contrário: é justamente quando a
 * conexão cai que ele precisa disparar. Por isso o motor de alertas roda fora do caminho do sync.
 */
const integracaoParada: Avaliador = async ({ tx, tenantId, hoje, params }) => {
  const atrasoMinutos = params.atrasoMinutos ?? 60;

  const conexao = await tx.erpConnection.findUnique({
    where: { tenantId },
    select: { status: true, lastError: true },
  });

  if (!conexao) return [];

  if (conexao.status === 'error') {
    return [
      {
        filialErpId: null,
        dedupeKey: `${hoje}:credencial`,
        resumo: 'A conexão com o ERP está com erro — os painéis vão parar de atualizar',
        payload: {
          motivo: conexao.lastError ?? 'falha na conexão',
          link: '/admin/conexao-erp',
        },
      },
    ];
  }

  // Sem falha declarada, o sintoma é o atraso: nenhum domínio essencial sincronizou a tempo.
  const limite = new Date(Date.now() - atrasoMinutos * 60_000);
  const marcas = await tx.syncWatermark.findMany({
    where: { domain: { in: ['vendas_hoje', 'resumo_filial'] } },
    select: { domain: true, lastSuccessAt: true },
  });

  if (marcas.length === 0) return [];

  const atrasados = marcas.filter((marca) => !marca.lastSuccessAt || marca.lastSuccessAt < limite);
  if (atrasados.length === 0 || atrasados.length < marcas.length) return [];

  return [
    {
      filialErpId: null,
      dedupeKey: `${hoje}:atraso`,
      resumo: `A sincronização com o ERP não conclui há mais de ${atrasoMinutos} minutos`,
      payload: {
        dominios: atrasados.map((marca) => marca.domain),
        atrasoMinutos,
        link: '/admin/sincronizacao',
      },
    },
  ];
};

// ---------------------------------------------------------------- financeiro
/**
 * Contas a pagar vencendo na janela configurada (doc 15 §8).
 *
 * Some o que vence e avisa **uma vez por dia**, com o total: a pessoa do financeiro quer saber
 * "quanto sai esta semana", não receber um e-mail por boleto.
 */
const contaAVencer: Avaliador = async ({ tx, hoje, params }) => {
  const dias = params.dias ?? 3;
  const valorMinimo = params.valorMinimo ?? 0;
  const limite = somarDias(hoje, dias);

  const linhas = await tx.$queryRaw<Array<{ parcelas: number; total: number | null }>>(Prisma.sql`
    SELECT COUNT(*)::int AS parcelas, SUM(COALESCE(saldo, valor_documento))::float8 AS total
    FROM erp_conta_pagar_parcelas
    WHERE paga = false
      AND data_vencimento IS NOT NULL
      AND data_vencimento BETWEEN ${hoje}::date AND ${limite}::date`);

  const resultado = linhas[0];
  const total = Number(resultado?.total ?? 0);
  if (!resultado || resultado.parcelas === 0 || total < valorMinimo) return [];

  const formatado = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return [
    {
      filialErpId: null,
      dedupeKey: `${hoje}:${dias}`,
      resumo: `${resultado.parcelas} ${resultado.parcelas === 1 ? 'parcela vence' : 'parcelas vencem'} em até ${dias} ${dias === 1 ? 'dia' : 'dias'}, somando ${formatado}`,
      payload: {
        parcelas: resultado.parcelas,
        total,
        dias,
        link: '/financeiro',
      },
    },
  ];
};

/**
 * Transações de cartão sem baixa depois do prazo.
 *
 * É dinheiro que a operadora deveria ter repassado e o ERP não registrou — o tipo de problema que
 * passa meses despercebido porque ninguém confere transação a transação.
 */
const cartaoNaoConciliado: Avaliador = async ({ tx, hoje, params }) => {
  const dias = params.dias ?? 7;
  const limite = somarDias(hoje, -dias);

  const linhas = await tx.$queryRaw<
    Array<{ filial_erp_id: number; transacoes: number; total: number | null }>
  >(Prisma.sql`
    SELECT filial_erp_id, COUNT(*)::int AS transacoes, SUM(valor_bruto)::float8 AS total
    FROM erp_cartao_vendas
    WHERE baixada = false
      AND data_venda IS NOT NULL
      AND data_venda <= ${limite}::date
    GROUP BY filial_erp_id
    ORDER BY total DESC`);

  const nomes = await nomesDeFilial(
    tx,
    linhas.map((linha) => linha.filial_erp_id),
  );

  return linhas.map((linha) => {
    const total = Number(linha.total ?? 0);
    const filial = nomes.get(linha.filial_erp_id) ?? `filial ${linha.filial_erp_id}`;
    const formatado = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    return {
      filialErpId: linha.filial_erp_id,
      dedupeKey: `${hoje}:${linha.filial_erp_id}`,
      resumo: `${linha.transacoes} ${linha.transacoes === 1 ? 'transação de cartão' : 'transações de cartão'} sem baixa há mais de ${dias} dias na ${filial} (${formatado})`,
      payload: {
        transacoes: linha.transacoes,
        total,
        dias,
        filial,
        link: `/financeiro?aba=cartoes&filiais=${linha.filial_erp_id}`,
      },
    };
  });
};

/** Registro de avaliadores. Tipo sem entrada aqui simplesmente não é avaliado (ainda). */
export const AVALIADORES: Partial<Record<AlertType, Avaliador>> = {
  ruptura_curva_a: ruptura,
  estoque_negativo: estoqueNegativo,
  divergencia_fechamento: divergenciaFechamento,
  queda_de_venda: quedaDeVenda,
  integracao_parada: integracaoParada,
  conta_a_vencer: contaAVencer,
  cartao_nao_conciliado: cartaoNaoConciliado,
};
