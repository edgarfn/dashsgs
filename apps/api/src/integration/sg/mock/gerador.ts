import { FIXTURE_FINALIZADORAS, FIXTURE_RESUMO_FILIAL, FIXTURE_VENDAS_DIA } from './fixtures';

/**
 * Fixtures com data (doc 24 §3).
 *
 * As coleções oficiais trazem um único dia de exemplo, e isso basta para testar normalização —
 * mas não para testar **sincronização**, que é feita de dias: consolidação, backfill de 90 dias,
 * idempotência ao repetir o mesmo dia. Em vez de inventar dados aleatórios (que tornariam os
 * testes instáveis), reaproveitamos a fixture oficial e trocamos a data: mesmas esquisitices de
 * formato, um dia por vez, sempre iguais para a mesma entrada.
 */

type Registro = Record<string, unknown>;

function clonar<T>(valor: T): T {
  return structuredClone(valor);
}

/** Vendas de um (filial, dia) com os itens e as char-flags da coleção oficial. */
export function gerarVendasDoDia(filial: number, data: string): Registro {
  const base = clonar(FIXTURE_VENDAS_DIA);
  const vendas = base.vendas.map((venda) => ({ ...venda, idFilial: filial, data }));

  return {
    paginacao: { ...base.paginacao, quantidadeItens: vendas.length },
    vendas,
  };
}

export function gerarFinalizadorasDoDia(filial: number, data: string): Registro {
  const base = clonar(FIXTURE_FINALIZADORAS);
  const finalizadoras = base.finalizadoras.map((lancamento) => ({
    ...lancamento,
    idFilial: filial,
    data,
  }));

  return {
    paginacao: { ...base.paginacao, quantidadeItens: finalizadoras.length },
    finalizadoras,
  };
}

/**
 * Resumo diário de um período. `gerouVendasDiaria` só é verdadeiro em dias **anteriores** ao
 * corrente: é o que faz a consolidação esperar o fechamento do ERP em vez de gravar um dia que
 * ainda vai mudar (doc 14 §2).
 */
export function gerarResumoFilial(
  filiais: number[],
  dataInicial: string,
  dataFinal: string,
  hoje: string,
): Registro {
  const modelo = clonar(FIXTURE_RESUMO_FILIAL).vendas[0] as Registro;
  const vendas: Registro[] = [];

  for (const filial of filiais) {
    for (let dia = dataInicial; dia <= dataFinal; dia = proximoDia(dia)) {
      const fechado = dia < hoje;
      vendas.push({
        ...modelo,
        idFilial: filial,
        data: dia,
        atualizouEstoque: fechado ? 'S' : ' ',
        gerouVendasDiaria: fechado ? 'S' : ' ',
        // Um dia por mês volta com divergência: é o gancho para o alerta da Fase 8 e garante que
        // o caminho de exceção seja exercitado em vez de ficar dormindo no código.
        possuiDivergencia: dia.endsWith('-13') ? 'S' : ' ',
      });
    }
  }

  return {
    paginacao: {
      pagina: 1,
      itensPorPagina: 200,
      quantidadePaginas: 1,
      quantidadeItens: vendas.length,
    },
    vendas,
  };
}

function proximoDia(dia: string): string {
  const data = new Date(`${dia}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + 1);
  return data.toISOString().slice(0, 10);
}

/**
 * Previsão de vendas do mês por filial (E5-11).
 *
 * Não há fixture oficial desta rota — a coleção da SG não traz exemplo —, então o gerador é a
 * única fonte. Ele é **determinístico**: mesma filial e mesma competência sempre devolvem o mesmo
 * número, senão dois ciclos de sync seguidos mostrariam metas diferentes e ninguém saberia se o
 * defeito é do produto ou do gerador.
 *
 * O valor é calibrado para ficar perto do que o gerador de vendas produz no mês, com a filial 1
 * folgada e as demais apertadas: assim o alerta "meta em risco" tem em que disparar sem que todas
 * as lojas fiquem vermelhas o tempo todo.
 */
export function gerarPrevisaoVendas(filiais: number[], ano: number, mes: number): Registro {
  const competencia = `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-01`;

  const previsoes = filiais.map((filial) => {
    const previsaoVenda = 420_000 + filial * 35_000;
    return {
      idFilial: filial,
      competencia,
      ano,
      mes,
      previsaoVenda,
      previsaoLucro: Number((previsaoVenda * 0.22).toFixed(2)),
      diasUteis: diasUteisDoMes(ano, mes),
    };
  });

  return {
    paginacao: {
      pagina: 1,
      itensPorPagina: 200,
      quantidadePaginas: 1,
      quantidadeItens: previsoes.length,
    },
    previsoes,
  };
}

/**
 * Curva diária da previsão.
 *
 * Distribuída por peso de dia da semana, e não em partes iguais: sábado vende quase o dobro de
 * uma terça, e uma curva plana faria a projeção acusar atraso toda segunda-feira. É exatamente o
 * comportamento que a tela de metas precisa exercitar.
 */
export function gerarPrevisaoDiaria(filial: number, ano: number, mes: number): Registro {
  const pesos = [0.7, 1, 1, 1, 1.1, 1.3, 1.8]; // domingo → sábado
  const dias = diasDoMes(ano, mes);
  const total = 420_000 + filial * 35_000;

  const soma = dias.reduce((acumulado, dia) => acumulado + pesos[diaDaSemana(dia)]!, 0);

  const previsoes = dias.map((dia) => ({
    idFilial: filial,
    data: dia,
    previsaoVenda: Number(((total * pesos[diaDaSemana(dia)]!) / soma).toFixed(2)),
  }));

  return {
    paginacao: {
      pagina: 1,
      itensPorPagina: 400,
      quantidadePaginas: 1,
      quantidadeItens: previsoes.length,
    },
    previsoes,
  };
}

function diasDoMes(ano: number, mes: number): string[] {
  const dias: string[] = [];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  for (let dia = 1; dia <= ultimo; dia += 1) {
    dias.push(
      `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
    );
  }
  return dias;
}

function diaDaSemana(dia: string): number {
  return new Date(`${dia}T00:00:00Z`).getUTCDay();
}

/** Supermercado abre domingo; "dia útil" aqui é todo dia menos domingo, como no ERP da loja. */
function diasUteisDoMes(ano: number, mes: number): number {
  return diasDoMes(ano, mes).filter((dia) => diaDaSemana(dia) !== 0).length;
}
