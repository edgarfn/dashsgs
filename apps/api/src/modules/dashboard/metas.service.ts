import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDatabase } from '../../common/tenant';
import { FrescorService } from './frescor.service';
import { filtroFiliais } from './home.service';

/** Como a projeção do mês foi calculada — a tela mostra isso, porque muda a confiança no número. */
export type BaseDaProjecao = 'curva_diaria' | 'proporcional' | 'sem_base';

export interface MetaDeFilial {
  filialErpId: number;
  filialNome: string;
  meta: number;
  realizado: number;
  /** Quanto do mês já deveria ter sido vendido a esta altura, segundo a previsão. */
  esperadoAteHoje: number;
  /** Realizado ÷ meta, em pontos percentuais. */
  atingimento: number;
  /** Onde o mês deve fechar se o ritmo se mantiver. */
  projecao: number;
  /** Projeção ÷ meta, em pontos percentuais — é este que aciona o alerta do doc 15 §8. */
  ritmo: number;
  diasUteis: number | null;
}

export interface MetasView {
  competencia: string;
  /** Dia do mês já decorrido (1 = primeiro dia), no fuso do tenant. */
  diaDoMes: number;
  diasNoMes: number;
  base: BaseDaProjecao;
  total: {
    meta: number;
    realizado: number;
    esperadoAteHoje: number;
    atingimento: number;
    projecao: number;
    ritmo: number;
  };
  porFilial: MetaDeFilial[];
  /** Curva acumulada para o gráfico: previsto × realizado, dia a dia. */
  curva: Array<{ data: string; previsto: number; realizado: number }>;
  frescor: { atualizadoEm: string | null; atrasado: boolean; provisorio: boolean };
}

/**
 * Metas: previsão × realizado e projeção de fechamento (doc 15 §7 / E7-03).
 *
 * O número que importa nesta tela não é o atingimento — é o **ritmo**. No dia 8, ter 25% da meta
 * não diz nada sozinho; o que diz é se, mantido o passo, o mês fecha acima ou abaixo. Por isso a
 * projeção é o destaque e o atingimento é o detalhe.
 *
 * A projeção tem duas bases, e a diferença entre elas é grande:
 *
 * - **Curva diária** (quando o ERP a fornece): compara o realizado com o previsto **para os dias
 *   que já passaram**. Respeita feriado e peso de dia da semana, porque quem lançou a curva na
 *   loja já respeitou.
 * - **Proporcional** (fallback): assume ritmo uniforme ao longo do mês. Simples e honesto, mas
 *   acusa atraso toda segunda-feira, porque o fim de semana vendeu mais do que 2/7 do total.
 *
 * A tela diz qual das duas está em uso. Mostrar uma projeção sem dizer de onde ela vem é pedir
 * para o gerente confiar em algo que pode estar sistematicamente errado.
 */
@Injectable()
export class MetasService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly frescor: FrescorService,
  ) {}

  async montar(params: {
    tenantId: string;
    filiais: number[] | null;
    /** Hoje no fuso do tenant (`YYYY-MM-DD`). */
    hoje: string;
    /** Competência pedida (`YYYY-MM`); ausente = mês de `hoje`. */
    competencia?: string;
  }): Promise<MetasView> {
    const { tenantId, hoje } = params;
    const competencia = params.competencia ?? hoje.slice(0, 7);
    const primeiroDia = `${competencia}-01`;
    const ultimoDia = fimDoMes(competencia);
    const recorte = filtroFiliais(params.filiais);

    // Mês passado é mês fechado: o corte é o último dia dele, não "hoje". Sem isso, consultar
    // agosto em setembro mostraria o mês inteiro como se faltassem 20 dias para vender.
    const ate = hoje < ultimoDia ? hoje : ultimoDia;
    const dentroDoMesCorrente = hoje >= primeiroDia && hoje <= ultimoDia;

    const [metas, realizados, curvaPrevista, curvaRealizada] = await this.tenantDb.run(
      tenantId,
      async (tx) => [
        await tx.$queryRaw<
          Array<{
            filial_erp_id: number;
            nome: string | null;
            meta: number;
            dias_uteis: number | null;
          }>
        >(Prisma.sql`
          SELECT p.filial_erp_id,
                 COALESCE(f.nome_fantasia, f.razao_social) AS nome,
                 SUM(p.previsao_venda)::float8 AS meta,
                 MAX(p.dias_uteis)::int AS dias_uteis
          FROM erp_previsao_vendas p
          LEFT JOIN erp_filiais f
            ON f.tenant_id = p.tenant_id AND f.erp_id = p.filial_erp_id
          WHERE p.competencia = ${primeiroDia}::date
            ${recorte('p.filial_erp_id')}
          GROUP BY p.filial_erp_id, f.nome_fantasia, f.razao_social`),

        // O realizado vem do resumo diário, não dos cupons: uma linha por filial×dia responde o
        // mesmo e cabe no orçamento de 300 ms (doc 15 §10).
        await tx.$queryRaw<Array<{ filial_erp_id: number; realizado: number }>>(Prisma.sql`
          SELECT filial_erp_id, COALESCE(SUM(valor), 0)::float8 AS realizado
          FROM erp_filial_venda_resumo
          WHERE data BETWEEN ${primeiroDia}::date AND ${ate}::date
            ${recorte('filial_erp_id')}
          GROUP BY filial_erp_id`),

        await tx.$queryRaw<Array<{ filial_erp_id: number; data: Date; previsto: number }>>(
          Prisma.sql`
            SELECT filial_erp_id, data, previsao_venda::float8 AS previsto
            FROM erp_previsao_vendas_diaria
            WHERE data BETWEEN ${primeiroDia}::date AND ${ultimoDia}::date
              ${recorte('filial_erp_id')}
            ORDER BY data`,
        ),

        await tx.$queryRaw<Array<{ data: Date; realizado: number }>>(Prisma.sql`
          SELECT data, COALESCE(SUM(valor), 0)::float8 AS realizado
          FROM erp_filial_venda_resumo
          WHERE data BETWEEN ${primeiroDia}::date AND ${ate}::date
            ${recorte('filial_erp_id')}
          GROUP BY data
          ORDER BY data`),
      ],
    );

    const frescor = await this.frescor.de(tenantId, 'previsao', null, {
      provisorio: dentroDoMesCorrente,
    });

    const realizadoPorFilial = new Map(
      realizados.map((linha) => [linha.filial_erp_id, Number(linha.realizado)]),
    );

    // Previsto acumulado até `ate`, por filial — a base "curva diária".
    const previstoAteHoje = new Map<number, number>();
    const previstoTotalDaCurva = new Map<number, number>();
    for (const linha of curvaPrevista) {
      const dia = iso(linha.data);
      const filial = linha.filial_erp_id;
      previstoTotalDaCurva.set(
        filial,
        (previstoTotalDaCurva.get(filial) ?? 0) + Number(linha.previsto),
      );
      if (dia <= ate) {
        previstoAteHoje.set(filial, (previstoAteHoje.get(filial) ?? 0) + Number(linha.previsto));
      }
    }

    const diasNoMes = Number(ultimoDia.slice(8, 10));
    const diaDoMes = Number(ate.slice(8, 10));
    const temCurva = curvaPrevista.length > 0;

    const porFilial: MetaDeFilial[] = metas
      .map((linha) => {
        const meta = Number(linha.meta);
        const realizado = realizadoPorFilial.get(linha.filial_erp_id) ?? 0;

        const fracao = temCurva
          ? fracaoPorCurva(
              previstoAteHoje.get(linha.filial_erp_id),
              previstoTotalDaCurva.get(linha.filial_erp_id),
            )
          : diaDoMes / diasNoMes;

        const esperadoAteHoje = meta * fracao;
        // Sem fração decorrida não há projeção possível: no dia 1, antes de vender, qualquer
        // divisão explodiria. `realizado` é a resposta honesta — é tudo que se sabe.
        const projecao = fracao > 0 ? realizado / fracao : realizado;

        return {
          filialErpId: linha.filial_erp_id,
          filialNome: linha.nome ?? `Filial ${linha.filial_erp_id}`,
          meta,
          realizado,
          esperadoAteHoje,
          atingimento: percentual(realizado, meta),
          projecao,
          ritmo: percentual(projecao, meta),
          diasUteis: linha.dias_uteis,
        };
      })
      .sort((a, b) => a.ritmo - b.ritmo);

    const total = somar(porFilial);

    return {
      competencia,
      diaDoMes,
      diasNoMes,
      base: metas.length === 0 ? 'sem_base' : temCurva ? 'curva_diaria' : 'proporcional',
      total,
      porFilial,
      curva: montarCurva(curvaPrevista, curvaRealizada),
      frescor,
    };
  }
}

/**
 * Fração do mês decorrida segundo a curva.
 *
 * Volta a `null` quando a curva não cobre o mês inteiro — previsão parcial dividiria por um total
 * menor que o real e inflaria o esperado, fazendo toda filial parecer atrasada.
 */
export function fracaoPorCurva(ateHoje: number | undefined, total: number | undefined): number {
  if (!total || total <= 0) return 0;
  return Math.min(1, (ateHoje ?? 0) / total);
}

export function percentual(valor: number, base: number): number {
  if (base <= 0) return 0;
  return Number(((valor / base) * 100).toFixed(1));
}

function somar(filiais: MetaDeFilial[]): MetasView['total'] {
  const meta = filiais.reduce((acumulado, filial) => acumulado + filial.meta, 0);
  const realizado = filiais.reduce((acumulado, filial) => acumulado + filial.realizado, 0);
  const esperadoAteHoje = filiais.reduce(
    (acumulado, filial) => acumulado + filial.esperadoAteHoje,
    0,
  );
  const projecao = filiais.reduce((acumulado, filial) => acumulado + filial.projecao, 0);

  return {
    meta,
    realizado,
    esperadoAteHoje,
    atingimento: percentual(realizado, meta),
    projecao,
    ritmo: percentual(projecao, meta),
  };
}

/**
 * Curva acumulada do mês: previsto e realizado no mesmo eixo.
 *
 * Acumulado, e não diário, de propósito: o diário é serrilhado (sábado alto, segunda baixo) e a
 * pergunta da tela — "estamos à frente ou atrás?" — é justamente sobre o acumulado. O realizado
 * para no último dia com dado; não se desenha linha reta sobre dia que ainda não aconteceu.
 */
export function montarCurva(
  previstos: Array<{ data: Date; previsto: number }>,
  realizados: Array<{ data: Date; realizado: number }>,
): MetasView['curva'] {
  const previstoPorDia = new Map<string, number>();
  for (const linha of previstos) {
    const dia = iso(linha.data);
    previstoPorDia.set(dia, (previstoPorDia.get(dia) ?? 0) + Number(linha.previsto));
  }

  const realizadoPorDia = new Map(
    realizados.map((linha) => [iso(linha.data), Number(linha.realizado)]),
  );

  const dias = [...new Set([...previstoPorDia.keys(), ...realizadoPorDia.keys()])].sort();
  const ultimoComRealizado = [...realizadoPorDia.keys()].sort().at(-1) ?? '';

  let previstoAcumulado = 0;
  let realizadoAcumulado = 0;

  return dias.map((dia) => {
    previstoAcumulado += previstoPorDia.get(dia) ?? 0;
    realizadoAcumulado += realizadoPorDia.get(dia) ?? 0;
    return {
      data: dia,
      previsto: Number(previstoAcumulado.toFixed(2)),
      realizado: dia <= ultimoComRealizado ? Number(realizadoAcumulado.toFixed(2)) : 0,
    };
  });
}

function iso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/** Último dia da competência (`YYYY-MM`) como `YYYY-MM-DD`. */
export function fimDoMes(competencia: string): string {
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7));
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${competencia}-${String(ultimo).padStart(2, '0')}`;
}
