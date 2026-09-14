import Link from 'next/link';
import { Alert } from '@/components/ui';
import {
  BarrasHorizontais,
  CardKpi,
  CurvaDoDia,
  EstadoVazio,
  SeloDeFrescor,
  formatar,
  type PontoDaCurva,
} from '@/components/dashboard';
import { Cabecalho, FiltrosGlobais } from '@/components/navegacao';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** A lista de filiais vem do catálogo de dimensões; o filtro só precisa de id e nome. */
function paraFiltro(filiais: FilialView[] | null) {
  return (filiais ?? [])
    .filter((filial) => filial.ativa)
    .map((filial) => ({ erpId: filial.erpId, nome: filial.nomeFantasia ?? filial.razaoSocial }));
}

interface Frescor {
  atualizadoEm: string | null;
  atrasado: boolean;
  provisorio: boolean;
}

interface HomeView {
  hoje: {
    data: string;
    venda: number;
    cupons: number;
    ticketMedio: number;
    porFilial: Array<{
      filialErpId: number;
      nome: string;
      venda: number;
      cupons: number;
      ticketMedio: number;
    }>;
    curva: PontoDaCurva[];
    frescor: Frescor;
  };
  consolidado: {
    data: string | null;
    venda: number;
    clientes: number | null;
    ticketMedio: number | null;
    margemPct: number | null;
    baseDeCusto: string;
    vendaSemanaAnterior: number | null;
    variacaoPct: number | null;
    frescor: Frescor;
  };
  fechamento: Array<{
    filialErpId: number;
    nome: string;
    data: string | null;
    atualizouEstoque: boolean;
    gerouVendasDiaria: boolean;
    exportouVendas: boolean;
    possuiDivergencia: boolean;
  }>;
  semDados: boolean;
}

/** Contagens do feed (`GET /alertas`): os nomes vêm da API, não são reinventados aqui. */
interface AlertasAbertos {
  abertos: number;
  reconhecidos: number;
  criticos: number;
}

interface FilialView {
  erpId: number;
  razaoSocial: string;
  nomeFantasia: string | null;
  ativa: boolean;
}

/**
 * Visão executiva (doc 15 §1 / E7-01).
 *
 * O padrão dos cinco segundos: a pessoa abre e já sabe como está o dia, sem clicar em nada. O que
 * vem antes de tudo é o número de hoje — provisório, e a tela diz isso — seguido da curva, do
 * ranking de filiais e do último dia fechado, que é o número definitivo.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireMe();
  const params = await searchParams;
  const filiaisParam = typeof params.filiais === 'string' ? params.filiais : undefined;
  const custo = typeof params.custo === 'string' ? params.custo : 'medio';

  if (!me.permissions.includes('dashboard.view')) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-12">
        <Cabecalho me={me} ativo="home" />
        <Alert kind="info">
          Sua conta ainda não tem acesso aos painéis desta rede. Fale com o administrador.
        </Alert>
      </main>
    );
  }

  const consulta = new URLSearchParams({ custo });
  if (filiaisParam) consulta.set('filiais', filiaisParam);

  const [resposta, filiais, alertas] = await Promise.all([
    apiRequest<HomeView>('GET', `/dashboard/home?${consulta.toString()}`),
    apiRequest<FilialView[]>('GET', '/dim/filiais'),
    // O feed só é consultado para quem recebe alerta — quem não recebe não precisa do número.
    me.permissions.includes('alerts.ack')
      ? apiRequest<{ contagens: AlertasAbertos }>('GET', '/alertas?status=open&itensPorPagina=5')
      : Promise.resolve({ data: null }),
  ]);

  const abertos = alertas.data?.contagens;

  const home = resposta.data;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-6 py-12">
      <Cabecalho me={me} ativo="home" />

      {!home ? (
        <Alert kind="error">
          Não foi possível carregar os indicadores agora. Tente novamente em alguns instantes.
        </Alert>
      ) : null}

      {abertos && abertos.abertos > 0 ? (
        <Alert kind={abertos.criticos > 0 ? 'error' : 'info'}>
          {abertos.abertos === 1 ? 'Há 1 alerta aberto' : `Há ${abertos.abertos} alertas abertos`}
          {abertos.criticos > 0
            ? ` — ${abertos.criticos} ${abertos.criticos === 1 ? 'crítico' : 'críticos'}`
            : ''}
          .{' '}
          <Link href="/alertas" className="underline underline-offset-4">
            Ver alertas
          </Link>
        </Alert>
      ) : null}

      {home?.semDados ? (
        <EstadoVazio
          titulo="Ainda não há dados do seu ERP"
          descricao="Assim que a conexão for testada, a sincronização começa e os primeiros números aparecem aqui em minutos. Para ver meses anteriores, peça a carga de histórico."
          acao={
            me.permissions.includes('erp_connection.manage')
              ? { href: '/admin/sincronizacao', rotulo: 'Ver sincronização' }
              : undefined
          }
        />
      ) : null}

      {home && !home.semDados ? (
        <>
          <FiltrosGlobais filiais={paraFiltro(filiais.data)} selecionadas={filiaisParam}>
            <div className="space-y-1.5">
              <label htmlFor="filtro-custo" className="block text-xs text-slate-400">
                Base de custo (margem)
              </label>
              <select
                id="filtro-custo"
                name="custo"
                defaultValue={custo}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400/60"
              >
                <option value="medio" className="bg-slate-900">
                  Custo médio
                </option>
                <option value="real" className="bg-slate-900">
                  Custo real
                </option>
                <option value="com_encargos" className="bg-slate-900">
                  Custo com encargos
                </option>
                <option value="fiscal_medio" className="bg-slate-900">
                  Custo fiscal médio
                </option>
                <option value="sem_icms" className="bg-slate-900">
                  Custo sem ICMS
                </option>
              </select>
            </div>
          </FiltrosGlobais>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
                Hoje ({formatar.dataCompleta(home.hoje.data)})
              </h2>
              <SeloDeFrescor frescor={home.hoje.frescor} />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <CardKpi titulo="Venda de hoje" valor={formatar.moeda(home.hoje.venda)} />
              <CardKpi titulo="Cupons" valor={formatar.inteiro(home.hoje.cupons)} />
              <CardKpi titulo="Ticket médio" valor={formatar.moeda(home.hoje.ticketMedio)} />
            </div>

            {home.hoje.frescor.provisorio ? (
              <p className="text-xs text-slate-500">
                Os números de hoje são provisórios: o ERP ainda recalcula cancelamentos e estoque no
                fechamento do dia.
              </p>
            ) : null}
          </section>

          <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
            <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
              Curva do dia
            </h2>
            <CurvaDoDia pontos={home.hoje.curva} />
          </section>

          {home.hoje.porFilial.length > 1 ? (
            <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
              <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
                Venda por filial (hoje)
              </h2>
              <BarrasHorizontais
                itens={home.hoje.porFilial.map((filial) => ({
                  chave: String(filial.filialErpId),
                  rotulo: filial.nome,
                  valor: filial.venda,
                  detalhe: `${formatar.inteiro(filial.cupons)} cupons · ticket ${formatar.moeda(filial.ticketMedio)}`,
                  href: `/vendas?filiais=${filial.filialErpId}`,
                }))}
              />
            </section>
          ) : null}

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
                Último dia fechado
                {home.consolidado.data ? ` (${formatar.dataCompleta(home.consolidado.data)})` : ''}
              </h2>
              <SeloDeFrescor frescor={home.consolidado.frescor} />
            </div>

            {home.consolidado.data ? (
              <div className="grid gap-4 sm:grid-cols-4">
                <CardKpi
                  titulo="Venda"
                  valor={formatar.moeda(home.consolidado.venda)}
                  variacaoPct={home.consolidado.variacaoPct}
                />
                <CardKpi
                  titulo="Clientes"
                  valor={formatar.inteiro(home.consolidado.clientes ?? 0)}
                />
                <CardKpi
                  titulo="Ticket médio"
                  valor={formatar.moeda(home.consolidado.ticketMedio ?? 0)}
                />
                <CardKpi
                  titulo="Margem bruta"
                  valor={formatar.percentual(home.consolidado.margemPct)}
                  detalhe={`base: ${home.consolidado.baseDeCusto.replace('_', ' ')}`}
                  restrito={home.consolidado.margemPct === null}
                />
              </div>
            ) : (
              <EstadoVazio
                titulo="Aguardando o primeiro fechamento"
                descricao="O dia consolidado aparece depois que o ERP fecha a venda diária. Enquanto isso, os números de hoje já estão acima."
              />
            )}
          </section>

          {home.fechamento.length > 0 ? (
            <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-6">
              <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
                Status do fechamento por filial
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Filial</th>
                      <th className="py-2 pr-4 font-medium">Dia</th>
                      <th className="py-2 pr-4 font-medium">Estoque</th>
                      <th className="py-2 pr-4 font-medium">Venda diária</th>
                      <th className="py-2 pr-4 font-medium">Divergência</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {home.fechamento.map((filial) => (
                      <tr key={filial.filialErpId}>
                        <td className="py-2 pr-4">{filial.nome}</td>
                        <td className="py-2 pr-4 tabular-nums">
                          {filial.data ? formatar.dataCompleta(filial.data) : '—'}
                        </td>
                        <td className="py-2 pr-4">
                          {filial.atualizouEstoque ? '✔ ok' : '• pendente'}
                        </td>
                        <td className="py-2 pr-4">
                          {filial.gerouVendasDiaria ? '✔ gerada' : '• pendente'}
                        </td>
                        <td className="py-2 pr-4">
                          {filial.possuiDivergencia ? (
                            <span className="text-amber-300">⚠ apontada pelo ERP</span>
                          ) : (
                            'sem divergência'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">
                Divergência apontada pelo ERP costuma indicar fechamento incompleto na loja — trate
                no ERP; a ressincronização é automática.
              </p>
            </section>
          ) : null}

          <p className="text-xs text-slate-500">
            Quer o detalhe cupom a cupom?{' '}
            <Link href="/vendas" className="text-sky-300 underline-offset-4 hover:underline">
              Abra o diário de vendas
            </Link>
            .
          </p>
        </>
      ) : null}
    </main>
  );
}
