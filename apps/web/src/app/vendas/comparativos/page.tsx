import Link from 'next/link';
import { Alert } from '@/components/ui';
import {
  BarrasHorizontais,
  CardKpi,
  EstadoVazio,
  SeloDeFrescor,
  formatar,
} from '@/components/dashboard';
import { classeProporcao } from '@/components/medidas';
import { Cabecalho, FiltrosGlobais } from '@/components/navegacao';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';

export const metadata = { title: 'Comparativos de vendas — DashSGS' };
export const dynamic = 'force-dynamic';

interface ComparativoView {
  periodo: { de: string; ate: string; dias: number };
  totais: {
    venda: number;
    clientes: number;
    ticketMedio: number;
    margemPct: number | null;
    baseDeCusto: string;
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
  frescor: { atualizadoEm: string | null; atrasado: boolean; provisorio: boolean };
}

interface FilialView {
  erpId: number;
  razaoSocial: string;
  nomeFantasia: string | null;
  ativa: boolean;
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function paraFiltro(filiais: FilialView[] | null) {
  return (filiais ?? [])
    .filter((filial) => filial.ativa)
    .map((filial) => ({ erpId: filial.erpId, nome: filial.nomeFantasia ?? filial.razaoSocial }));
}

/** Série em barras verticais: 30 a 90 barras cabem numa faixa, e cada uma carrega seu título. */
function SerieDiaria({ serie }: { serie: ComparativoView['serie'] }) {
  const maximo = Math.max(...serie.map((ponto) => ponto.venda), 1);

  return (
    <figure className="space-y-3">
      <div className="flex h-40 items-end gap-[2px] overflow-x-auto">
        {serie.map((ponto) => (
          <div key={ponto.data} className="flex h-full min-w-[6px] flex-1 items-end">
            <div
              data-barra
              className={`w-full rounded-t bg-sky-500/70 medida-altura ${classeProporcao(
                ponto.venda,
                maximo,
              )}`}
              title={`${formatar.dataCompleta(ponto.data)} — ${formatar.moeda(ponto.venda)}`}
            />
          </div>
        ))}
      </div>
      <figcaption className="flex justify-between text-xs text-slate-500">
        <span>{formatar.dataCompleta(serie[0]?.data ?? '')}</span>
        <span>{formatar.dataCompleta(serie[serie.length - 1]?.data ?? '')}</span>
      </figcaption>

      <details className="text-sm text-slate-300">
        <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
          Ver dados da série
        </summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-1 pr-4 font-medium">Dia</th>
              <th className="py-1 pr-4 font-medium">Venda</th>
              <th className="py-1 pr-4 font-medium">Clientes</th>
              <th className="py-1 pr-4 font-medium">Margem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {serie.map((ponto) => (
              <tr key={`linha-${ponto.data}`}>
                <td className="py-1 pr-4 tabular-nums">{formatar.dataCompleta(ponto.data)}</td>
                <td className="py-1 pr-4 tabular-nums">{formatar.moeda(ponto.venda)}</td>
                <td className="py-1 pr-4 tabular-nums">{formatar.inteiro(ponto.clientes)}</td>
                <td className="py-1 pr-4 tabular-nums">{formatar.percentual(ponto.margemPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/**
 * Vendas — Comparativos (doc 15 §2 / E7-02).
 *
 * Responde às três perguntas que o varejista faz sobre um período: como foi a evolução, qual
 * loja puxou o resultado e o que vendeu dentro dele. O corte por dia da semana entra porque
 * comparar sábado com terça é o erro mais comum de leitura de série diária.
 */
export default async function ComparativosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireMe();
  const params = await searchParams;

  if (!me.permissions.includes('dashboard.view')) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-12">
        <Cabecalho me={me} ativo="vendas" />
        <Alert kind="info">Sua conta não tem acesso aos painéis desta rede.</Alert>
      </main>
    );
  }

  const texto = (chave: string) => (typeof params[chave] === 'string' ? params[chave] : undefined);
  const hoje = new Date().toISOString().slice(0, 10);
  const trintaDias = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);

  const de = texto('de') ?? trintaDias;
  const ate = texto('ate') ?? hoje;
  const filiaisParam = texto('filiais');
  const custo = texto('custo') ?? 'medio';

  const consulta = new URLSearchParams({ de, ate, custo });
  if (filiaisParam) consulta.set('filiais', filiaisParam);

  const [resposta, filiais] = await Promise.all([
    apiRequest<ComparativoView>('GET', `/dashboard/vendas/comparativo?${consulta.toString()}`),
    apiRequest<FilialView[]>('GET', '/dim/filiais'),
  ]);

  const dados = resposta.data;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-12">
      <Cabecalho me={me} ativo="vendas" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-white">Comparativos</h2>
        <div className="flex items-center gap-3">
          {dados ? <SeloDeFrescor frescor={dados.frescor} /> : null}
          <Link href="/vendas" className="text-sm text-sky-300 underline-offset-4 hover:underline">
            Ver o diário
          </Link>
        </div>
      </div>

      <FiltrosGlobais filiais={paraFiltro(filiais.data)} selecionadas={filiaisParam}>
        <div className="space-y-1.5">
          <label htmlFor="filtro-de" className="block text-xs text-slate-400">
            De
          </label>
          <input
            id="filtro-de"
            type="date"
            name="de"
            defaultValue={de}
            max={hoje}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400/60"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="filtro-ate" className="block text-xs text-slate-400">
            Até
          </label>
          <input
            id="filtro-ate"
            type="date"
            name="ate"
            defaultValue={ate}
            max={hoje}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400/60"
          />
        </div>
      </FiltrosGlobais>

      {!dados ? (
        <Alert kind="error">
          Não foi possível carregar o comparativo. Verifique o período informado.
        </Alert>
      ) : dados.serie.length === 0 ? (
        <EstadoVazio
          titulo="Sem dias fechados no período"
          descricao="Os comparativos usam o resumo diário que o ERP gera no fechamento. Se a rede acabou de conectar, peça a carga de histórico para ver meses anteriores."
          acao={
            me.permissions.includes('erp_connection.manage')
              ? { href: '/admin/sincronizacao', rotulo: 'Carregar histórico' }
              : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <CardKpi
              titulo="Venda do período"
              valor={formatar.moeda(dados.totais.venda)}
              detalhe={`${dados.periodo.dias} dias`}
            />
            <CardKpi titulo="Clientes" valor={formatar.inteiro(dados.totais.clientes)} />
            <CardKpi titulo="Ticket médio" valor={formatar.moeda(dados.totais.ticketMedio)} />
            <CardKpi
              titulo="Margem bruta"
              valor={formatar.percentual(dados.totais.margemPct)}
              detalhe={`base: ${dados.totais.baseDeCusto.replace('_', ' ')}`}
              restrito={dados.totais.margemPct === null}
            />
          </div>

          <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
            <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">
              Venda por dia
            </h3>
            <SerieDiaria serie={dados.serie} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
              <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">
                Ranking de filiais
              </h3>
              <BarrasHorizontais
                itens={dados.porFilial.map((filial) => ({
                  chave: String(filial.filialErpId),
                  rotulo: filial.nome,
                  valor: filial.venda,
                  detalhe: `${formatar.percentual(filial.participacaoPct)} do total · ${formatar.inteiro(filial.clientes)} clientes`,
                }))}
              />
            </section>

            <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
              <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">
                Por dia da semana (média)
              </h3>
              <BarrasHorizontais
                itens={dados.porDiaDaSemana.map((dia) => ({
                  chave: String(dia.diaDaSemana),
                  rotulo: DIAS[dia.diaDaSemana] ?? String(dia.diaDaSemana),
                  valor: dia.media,
                  detalhe: `total ${formatar.moeda(dia.venda)}`,
                }))}
              />
            </section>
          </div>

          {dados.porDepartamento.length > 0 ? (
            <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
              <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">
                Venda por departamento
              </h3>
              <BarrasHorizontais
                itens={dados.porDepartamento.slice(0, 12).map((dep) => ({
                  chave: dep.dep1ErpId,
                  rotulo: dep.nome,
                  valor: dep.venda,
                  detalhe:
                    dep.margemPct === null
                      ? `${formatar.decimal(dep.quantidade)} unidades`
                      : `${formatar.decimal(dep.quantidade)} unidades · margem ${formatar.percentual(dep.margemPct)}`,
                }))}
              />
              <p className="text-xs text-slate-500">
                A margem por departamento usa o custo atual do cadastro do produto — a API não
                devolve o custo praticado no momento da venda (doc 33).
              </p>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
