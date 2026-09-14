import Link from 'next/link';
import { classeProporcao } from './medidas';

/**
 * Peças do dashboard (doc 16 §3 e §5).
 *
 * Os gráficos são **SVG renderizado no servidor**, sem biblioteca: a curva do dia tem 24 pontos e
 * o ranking, meia dúzia de barras. Uma biblioteca de gráficos custaria centenas de kB no bundle
 * inicial — que o doc 16 §5 limita a 250 kB — para desenhar o que cabe em algumas tags. Cada
 * gráfico vem acompanhado da tabela equivalente (`<details>`), que é o requisito de
 * acessibilidade do doc 16 §5 e, de quebra, o que o usuário copia para a planilha.
 */

const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});
const compacto = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const inteiro = new Intl.NumberFormat('pt-BR');
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const formatar = {
  moeda: (valor: number) => moeda.format(valor),
  moedaCompacta: (valor: number) => compacto.format(valor),
  inteiro: (valor: number) => inteiro.format(valor),
  decimal: (valor: number) => decimal.format(valor),
  percentual: (valor: number | null) =>
    valor === null ? '—' : `${decimal.format(valor)}%`.replace('.', ','),
  dia: (iso: string) => iso.split('-').reverse().slice(0, 2).join('/'),
  dataCompleta: (iso: string) => iso.split('-').reverse().join('/'),
};

/** Selo de frescor: quando o dado chegou e se ele ainda vai mudar (doc 15 §9). */
export function SeloDeFrescor({
  frescor,
  className = '',
}: {
  frescor: { atualizadoEm: string | null; atrasado: boolean; provisorio: boolean };
  className?: string;
}) {
  const estilo = frescor.atrasado
    ? 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
    : 'bg-slate-500/10 text-slate-300 ring-slate-500/20';

  const quando = frescor.atualizadoEm
    ? `dados de ${dataHora.format(new Date(frescor.atualizadoEm))}`
    : 'ainda não sincronizado';

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 ring-inset ${estilo} ${className}`}
    >
      {frescor.provisorio ? <strong className="font-medium">parcial</strong> : null}
      {quando}
      {frescor.atrasado ? ' · atrasado' : ''}
    </span>
  );
}

export function CardKpi({
  titulo,
  valor,
  detalhe,
  variacaoPct,
  restrito = false,
}: {
  titulo: string;
  valor: string;
  detalhe?: string;
  variacaoPct?: number | null;
  /** `true` quando o papel do usuário não enxerga este número (doc 15 §1). */
  restrito?: boolean;
}) {
  const sobe = (variacaoPct ?? 0) >= 0;

  return (
    <article className="space-y-1 rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <h3 className="text-xs uppercase tracking-wider text-slate-500">{titulo}</h3>
      <p className="text-2xl font-semibold tabular-nums text-white">{restrito ? '—' : valor}</p>
      {restrito ? (
        <p className="text-xs text-slate-500">Disponível para gerentes e administradores.</p>
      ) : null}
      {!restrito && detalhe ? <p className="text-xs text-slate-400">{detalhe}</p> : null}
      {!restrito && variacaoPct !== undefined && variacaoPct !== null ? (
        <p className={`text-xs ${sobe ? 'text-emerald-300' : 'text-rose-300'}`}>
          {/* Seta + sinal: nunca só cor (doc 16 §5). */}
          {sobe ? '▲' : '▼'} {formatar.percentual(Math.abs(variacaoPct))} vs. semana anterior
        </p>
      ) : null}
    </article>
  );
}

export interface PontoDaCurva {
  hora: number;
  valor: number;
  cupons: number;
  mediaHistorica: number | null;
}

/** Curva do dia com a média das quatro semanas anteriores por baixo (doc 15 §1). */
export function CurvaDoDia({ pontos }: { pontos: PontoDaCurva[] }) {
  if (pontos.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Ainda não há vendas registradas hoje. A curva aparece na primeira sincronização do dia.
      </p>
    );
  }

  const largura = 720;
  const altura = 200;
  const margem = { topo: 12, base: 24, lado: 8 };

  const maximo = Math.max(
    ...pontos.map((ponto) => Math.max(ponto.valor, ponto.mediaHistorica ?? 0)),
    1,
  );
  const passo = pontos.length > 1 ? (largura - margem.lado * 2) / (pontos.length - 1) : 0;

  const coordenadas = (valor: number, indice: number) => {
    const x = margem.lado + indice * passo;
    const y = altura - margem.base - (valor / maximo) * (altura - margem.topo - margem.base);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  const linhaVenda = pontos.map((ponto, i) => coordenadas(ponto.valor, i)).join(' ');
  const linhaMedia = pontos.every((ponto) => ponto.mediaHistorica !== null)
    ? pontos.map((ponto, i) => coordenadas(ponto.mediaHistorica ?? 0, i)).join(' ')
    : null;

  return (
    <figure className="space-y-3">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${largura} ${altura}`}
          className="h-48 w-full min-w-[32rem]"
          role="img"
          aria-label={`Venda por hora de hoje, máximo de ${formatar.moeda(maximo)}`}
        >
          {linhaMedia ? (
            <polyline
              points={linhaMedia}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="4 4"
              className="text-slate-600"
            />
          ) : null}
          <polyline
            points={linhaVenda}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-sky-400"
          />
          {pontos.map((ponto, i) => (
            <circle
              key={ponto.hora}
              cx={margem.lado + i * passo}
              cy={
                altura - margem.base - (ponto.valor / maximo) * (altura - margem.topo - margem.base)
              }
              r="3"
              className="fill-sky-300"
            >
              <title>{`${String(ponto.hora).padStart(2, '0')}h — ${formatar.moeda(ponto.valor)} em ${ponto.cupons} cupons`}</title>
            </circle>
          ))}
          {pontos.map((ponto, i) => (
            <text
              key={`rotulo-${ponto.hora}`}
              x={margem.lado + i * passo}
              y={altura - 6}
              textAnchor="middle"
              className="fill-slate-500 text-[10px]"
            >
              {String(ponto.hora).padStart(2, '0')}
            </text>
          ))}
        </svg>
      </div>

      <figcaption className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-4 bg-sky-400" aria-hidden="true" /> hoje
        </span>
        {linhaMedia ? (
          <span className="inline-flex items-center gap-1">
            <span
              className="h-0.5 w-4 border-t-2 border-dashed border-slate-600"
              aria-hidden="true"
            />{' '}
            média das 4 semanas anteriores
          </span>
        ) : null}
      </figcaption>

      <details className="text-sm text-slate-300">
        <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
          Ver dados da curva
        </summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-1 pr-4 font-medium">Hora</th>
              <th className="py-1 pr-4 font-medium">Venda</th>
              <th className="py-1 pr-4 font-medium">Cupons</th>
              <th className="py-1 pr-4 font-medium">Média 4 semanas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {pontos.map((ponto) => (
              <tr key={`linha-${ponto.hora}`}>
                <td className="py-1 pr-4 tabular-nums">{String(ponto.hora).padStart(2, '0')}h</td>
                <td className="py-1 pr-4 tabular-nums">{formatar.moeda(ponto.valor)}</td>
                <td className="py-1 pr-4 tabular-nums">{formatar.inteiro(ponto.cupons)}</td>
                <td className="py-1 pr-4 tabular-nums">
                  {ponto.mediaHistorica === null ? '—' : formatar.moeda(ponto.mediaHistorica)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Ranking horizontal — usado para filiais e departamentos. */
export function BarrasHorizontais({
  itens,
  rotuloValor = formatar.moeda,
}: {
  itens: Array<{ chave: string; rotulo: string; valor: number; detalhe?: string; href?: string }>;
  rotuloValor?: (valor: number) => string;
}) {
  if (itens.length === 0) {
    return <p className="text-sm text-slate-400">Sem dados no período selecionado.</p>;
  }

  const maximo = Math.max(...itens.map((item) => item.valor), 1);

  return (
    <ul className="space-y-3">
      {itens.map((item) => (
        <li key={item.chave} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-200">
              {item.href ? (
                <Link href={item.href} className="hover:underline">
                  {item.rotulo}
                </Link>
              ) : (
                item.rotulo
              )}
            </span>
            <span className="tabular-nums text-slate-300">{rotuloValor(item.valor)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div
              data-barra
              className={`h-full rounded-full bg-sky-500/70 medida-largura ${classeProporcao(
                item.valor,
                maximo,
              )}`}
            />
          </div>
          {item.detalhe ? <p className="text-xs text-slate-500">{item.detalhe}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** Estado vazio explicativo: o que falta e qual é o próximo passo (doc 16 §3). */
export function EstadoVazio({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao: string;
  acao?: { href: string; rotulo: string };
}) {
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-white/15 bg-white/[0.01] p-8 text-center">
      <h3 className="text-base font-medium text-white">{titulo}</h3>
      <p className="mx-auto max-w-lg text-sm text-slate-400">{descricao}</p>
      {acao ? (
        <Link
          href={acao.href}
          className="inline-block rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5"
        >
          {acao.rotulo}
        </Link>
      ) : null}
    </div>
  );
}
