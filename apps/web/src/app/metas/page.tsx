import Link from 'next/link';
import { Alert } from '@/components/ui';
import { CardKpi, EstadoVazio, SeloDeFrescor, formatar } from '@/components/dashboard';
import { classeMedida } from '@/components/medidas';
import { Cabecalho, FiltrosGlobais } from '@/components/navegacao';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';

export const metadata = { title: 'Metas — DashSGS' };
export const dynamic = 'force-dynamic';

interface MetaDeFilial {
  filialErpId: number;
  filialNome: string;
  meta: number;
  realizado: number;
  esperadoAteHoje: number;
  atingimento: number;
  projecao: number;
  ritmo: number;
  diasUteis: number | null;
}

interface MetasView {
  competencia: string;
  diaDoMes: number;
  diasNoMes: number;
  base: 'curva_diaria' | 'proporcional' | 'sem_base';
  total: {
    meta: number;
    realizado: number;
    esperadoAteHoje: number;
    atingimento: number;
    projecao: number;
    ritmo: number;
  };
  porFilial: MetaDeFilial[];
  curva: Array<{ data: string; previsto: number; realizado: number }>;
  frescor: { atualizadoEm: string | null; atrasado: boolean; provisorio: boolean };
}

interface FilialView {
  erpId: number;
  razaoSocial: string;
  nomeFantasia: string | null;
  ativa: boolean;
}

function paraFiltro(filiais: FilialView[] | null) {
  return (filiais ?? [])
    .filter((filial) => filial.ativa)
    .map((filial) => ({ erpId: filial.erpId, nome: filial.nomeFantasia ?? filial.razaoSocial }));
}

/** Verde acima da meta, âmbar no limiar do alerta, vermelho abaixo dele (doc 15 §8: 90%). */
function corDoRitmo(ritmo: number): string {
  if (ritmo >= 100) return 'text-app-success';
  if (ritmo >= 90) return 'text-app-warning';
  return 'text-app-danger';
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

function nomeDaCompetencia(competencia: string): string {
  const mes = Number(competencia.slice(5, 7));
  return `${MESES[mes - 1]} de ${competencia.slice(0, 4)}`;
}

/**
 * Metas — previsão × realizado e projeção de fechamento (doc 15 §7 / E7-03).
 *
 * O destaque da tela é o **ritmo**, não o atingimento: no dia 10, ter 30% da meta não diz nada
 * sozinho; o que diz é onde o mês fecha se o passo se mantiver. Por isso a projeção vem no
 * primeiro card e a lista de filiais é ordenada da pior para a melhor — quem precisa de ação
 * aparece primeiro, sem ninguém procurar.
 */
export default async function MetasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireMe();
  const params = await searchParams;

  if (!me.permissions.includes('dashboard.view')) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-12">
        <Cabecalho me={me} ativo="metas" />
        <Alert kind="info">Sua conta não tem acesso aos painéis desta rede.</Alert>
      </main>
    );
  }

  const texto = (chave: string) => (typeof params[chave] === 'string' ? params[chave] : undefined);
  const competenciaParam = texto('competencia');
  const filiaisParam = texto('filiais');

  const consulta = new URLSearchParams();
  if (competenciaParam) consulta.set('competencia', competenciaParam);
  if (filiaisParam) consulta.set('filiais', filiaisParam);

  const [resposta, filiais] = await Promise.all([
    apiRequest<MetasView>('GET', `/dashboard/metas?${consulta.toString()}`),
    apiRequest<FilialView[]>('GET', '/dim/filiais'),
  ]);

  const dados = resposta.data;
  const maiorMeta = Math.max(...(dados?.porFilial ?? []).map((filial) => filial.meta), 1);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-12">
      <Cabecalho me={me} ativo="metas" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-app-fg">
          Metas{dados ? ` — ${nomeDaCompetencia(dados.competencia)}` : ''}
        </h2>
        <div className="flex items-center gap-3">
          {dados ? <SeloDeFrescor frescor={dados.frescor} /> : null}
          <Link
            href="/vendas"
            className="text-sm text-app-accent underline-offset-4 hover:underline"
          >
            Ver vendas
          </Link>
        </div>
      </div>

      <FiltrosGlobais filiais={paraFiltro(filiais.data)} selecionadas={filiaisParam}>
        <div className="space-y-1.5">
          <label htmlFor="filtro-competencia" className="block text-xs text-app-muted">
            Competência
          </label>
          <input
            id="filtro-competencia"
            type="month"
            name="competencia"
            defaultValue={dados?.competencia ?? competenciaParam}
            className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-fg outline-none focus:border-app-accent/60"
          />
        </div>
      </FiltrosGlobais>

      {!dados ? (
        <Alert kind="error">Não foi possível carregar as metas agora.</Alert>
      ) : dados.base === 'sem_base' ? (
        <EstadoVazio
          titulo="Nenhuma meta lançada para este mês"
          descricao="As metas vêm da previsão de vendas do ERP, sincronizada uma vez por dia. Se o módulo de previsão não é usado na loja, esta tela permanece vazia — e nenhum alerta de meta é gerado."
          acao={
            me.permissions.includes('erp_connection.manage')
              ? { href: '/admin/sincronizacao', rotulo: 'Ver sincronização' }
              : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <CardKpi
              titulo="Projeção do mês"
              valor={formatar.moeda(dados.total.projecao)}
              detalhe={`${formatar.percentual(dados.total.ritmo)} da meta`}
            />
            <CardKpi titulo="Meta do mês" valor={formatar.moeda(dados.total.meta)} />
            <CardKpi
              titulo="Realizado"
              valor={formatar.moeda(dados.total.realizado)}
              detalhe={`${formatar.percentual(dados.total.atingimento)} da meta · dia ${dados.diaDoMes} de ${dados.diasNoMes}`}
            />
            <CardKpi
              titulo="Esperado até hoje"
              valor={formatar.moeda(dados.total.esperadoAteHoje)}
              detalhe={
                dados.total.realizado >= dados.total.esperadoAteHoje
                  ? `${formatar.moeda(dados.total.realizado - dados.total.esperadoAteHoje)} à frente`
                  : `${formatar.moeda(dados.total.esperadoAteHoje - dados.total.realizado)} atrás`
              }
            />
          </div>

          <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium uppercase tracking-wider text-app-muted">
                Ritmo por filial
              </h3>
              <p className="text-xs text-app-muted">
                Ordenado do pior para o melhor. O alerta de meta em risco dispara abaixo de 90%.
              </p>
            </div>

            <ul className="space-y-4">
              {dados.porFilial.map((filial) => (
                <li key={filial.filialErpId} className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-3 text-sm">
                    <Link
                      href={`/vendas?filiais=${filial.filialErpId}`}
                      className="text-app-fg hover:underline"
                    >
                      {filial.filialNome}
                    </Link>
                    <span className={`tabular-nums ${corDoRitmo(filial.ritmo)}`}>
                      {/* Palavra junto do número: cor sozinha não comunica (doc 16 §5). */}
                      {filial.ritmo >= 100 ? 'acima da meta' : 'abaixo da meta'} ·{' '}
                      {formatar.percentual(filial.ritmo)}
                    </span>
                  </div>

                  {/*
                    Duas barras sobrepostas na mesma escala (a maior meta da lista): a de baixo é
                    a meta, a de cima o realizado, e o traço marca onde deveríamos estar hoje. É
                    a leitura de cinco segundos que o doc 15 §9 pede.
                  */}
                  <div className="relative h-3 overflow-hidden rounded-full bg-app-surface">
                    <div
                      className={`absolute inset-y-0 left-0 bg-app-hover medida-largura ${classeMedida((filial.meta / maiorMeta) * 100)}`}
                    />
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full bg-app-accent/70 medida-largura ${classeMedida((filial.realizado / maiorMeta) * 100)}`}
                    />
                    <div
                      className={`absolute inset-y-0 w-px bg-app-warning medida-esquerda ${classeMedida((filial.esperadoAteHoje / maiorMeta) * 100)}`}
                    />
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-app-muted">
                    <span>Meta {formatar.moeda(filial.meta)}</span>
                    <span>Realizado {formatar.moeda(filial.realizado)}</span>
                    <span>Esperado hoje {formatar.moeda(filial.esperadoAteHoje)}</span>
                    <span>Projeção {formatar.moeda(filial.projecao)}</span>
                    {filial.diasUteis ? <span>{filial.diasUteis} dias úteis</span> : null}
                  </div>
                </li>
              ))}
            </ul>

            <details className="text-xs text-app-muted">
              <summary className="cursor-pointer text-app-muted">Ver dados</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left">
                  <thead className="text-app-muted">
                    <tr>
                      <th className="py-1 pr-4 font-medium">Filial</th>
                      <th className="py-1 pr-4 text-right font-medium">Meta</th>
                      <th className="py-1 pr-4 text-right font-medium">Realizado</th>
                      <th className="py-1 pr-4 text-right font-medium">Atingimento</th>
                      <th className="py-1 pr-4 text-right font-medium">Projeção</th>
                      <th className="py-1 pr-4 text-right font-medium">Ritmo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-app-border text-app-muted">
                    {dados.porFilial.map((filial) => (
                      <tr key={filial.filialErpId}>
                        <td className="py-1 pr-4">{filial.filialNome}</td>
                        <td className="py-1 pr-4 text-right tabular-nums">
                          {formatar.moeda(filial.meta)}
                        </td>
                        <td className="py-1 pr-4 text-right tabular-nums">
                          {formatar.moeda(filial.realizado)}
                        </td>
                        <td className="py-1 pr-4 text-right tabular-nums">
                          {formatar.percentual(filial.atingimento)}
                        </td>
                        <td className="py-1 pr-4 text-right tabular-nums">
                          {formatar.moeda(filial.projecao)}
                        </td>
                        <td className="py-1 pr-4 text-right tabular-nums">
                          {formatar.percentual(filial.ritmo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          <p className="text-xs text-app-muted">
            {dados.base === 'curva_diaria'
              ? 'A projeção segue a curva diária lançada no ERP: sábado e feriado pesam o que a loja previu que pesariam.'
              : 'O ERP não informa a curva diária deste mês, então a projeção assume ritmo uniforme — ela tende a parecer pior no começo da semana e melhor no fim.'}
          </p>
        </>
      )}
    </main>
  );
}
