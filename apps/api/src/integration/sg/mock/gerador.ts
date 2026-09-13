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
