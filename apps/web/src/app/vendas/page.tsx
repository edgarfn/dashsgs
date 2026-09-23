import Link from 'next/link';
import { Alert } from '@/components/ui';
import {
  BarrasHorizontais,
  CardKpi,
  EstadoVazio,
  SeloDeFrescor,
  formatar,
} from '@/components/dashboard';
import { Cabecalho, FiltrosGlobais } from '@/components/navegacao';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';

export const metadata = { title: 'Vendas — DashSGS' };
export const dynamic = 'force-dynamic';

interface VendasDiaView {
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
  cupons: Array<{
    filialErpId: number;
    filialNome: string;
    caixa: number;
    cupom: number;
    horario: string | null;
    itens: number;
    valorTotal: number;
    desconto: number;
    cancelada: boolean;
    identificada: boolean;
    formas: string[];
  }>;
  paginacao: { pagina: number; itensPorPagina: number; total: number; paginas: number };
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

/**
 * Vendas — Diário (doc 15 §2 / doc 16 §2 / E7-02).
 *
 * É a tela do "o total não bate": cupom a cupom, com filtro de caixa e de cancelamento, e o
 * mesmo recorte de filiais do resto do produto. Daqui o gerente sai com o número do cupom para
 * procurar no ERP — por isso a tabela mostra caixa, cupom e horário antes do valor.
 */
export default async function VendasPage({
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
  const data = texto('data') ?? hoje;
  const filiaisParam = texto('filiais');
  const caixa = texto('caixa');
  const canceladas = texto('canceladas');
  const pagina = Number(texto('pagina') ?? '1');

  const consulta = new URLSearchParams({ data, pagina: String(pagina) });
  if (filiaisParam) consulta.set('filiais', filiaisParam);
  if (caixa) consulta.set('caixa', caixa);
  if (canceladas) consulta.set('canceladas', canceladas);

  const [resposta, filiais] = await Promise.all([
    apiRequest<VendasDiaView>('GET', `/dashboard/vendas/dia?${consulta.toString()}`),
    apiRequest<FilialView[]>('GET', '/dim/filiais'),
  ]);

  const dia = resposta.data;
  const paginaUrl = (numero: number) => {
    const alvo = new URLSearchParams(consulta);
    alvo.set('pagina', String(numero));
    return `/vendas?${alvo.toString()}`;
  };

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-12">
      <Cabecalho me={me} ativo="vendas" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-app-fg">
          Diário de vendas — {formatar.dataCompleta(data)}
        </h2>
        <div className="flex items-center gap-3">
          {dia ? <SeloDeFrescor frescor={dia.frescor} /> : null}
          <Link
            href={`/vendas/comparativos?${filiaisParam ? `filiais=${filiaisParam}` : ''}`}
            className="text-sm text-app-accent underline-offset-4 hover:underline"
          >
            Ver comparativos
          </Link>
        </div>
      </div>

      <FiltrosGlobais filiais={paraFiltro(filiais.data)} selecionadas={filiaisParam}>
        <div className="space-y-1.5">
          <label htmlFor="filtro-data" className="block text-xs text-app-muted">
            Dia
          </label>
          <input
            id="filtro-data"
            type="date"
            name="data"
            defaultValue={data}
            max={hoje}
            className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-fg outline-none focus:border-app-accent/60"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="filtro-caixa" className="block text-xs text-app-muted">
            Caixa
          </label>
          <input
            id="filtro-caixa"
            type="number"
            name="caixa"
            min={1}
            defaultValue={caixa ?? ''}
            placeholder="todos"
            className="w-24 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-fg outline-none focus:border-app-accent/60"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="filtro-canceladas" className="block text-xs text-app-muted">
            Situação
          </label>
          <select
            id="filtro-canceladas"
            name="canceladas"
            defaultValue={canceladas ?? ''}
            className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-fg outline-none focus:border-app-accent/60"
          >
            <option value="" className="bg-app-bg">
              Todos os cupons
            </option>
            <option value="false" className="bg-app-bg">
              Somente válidos
            </option>
            <option value="true" className="bg-app-bg">
              Somente cancelados
            </option>
          </select>
        </div>
      </FiltrosGlobais>

      {!dia ? (
        <Alert kind="error">Não foi possível carregar as vendas deste dia.</Alert>
      ) : dia.paginacao.total === 0 ? (
        <EstadoVazio
          titulo="Nenhum cupom neste dia"
          descricao="Ou a loja não vendeu, ou este dia ainda não foi sincronizado. Confira a data escolhida e o estado da sincronização."
          acao={
            me.permissions.includes('erp_connection.manage')
              ? { href: '/admin/sincronizacao', rotulo: 'Ver sincronização' }
              : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <CardKpi titulo="Venda" valor={formatar.moeda(dia.totais.venda)} />
            <CardKpi
              titulo="Cupons"
              valor={formatar.inteiro(dia.totais.cupons)}
              detalhe={`${formatar.decimal(dia.totais.itensPorCupom)} itens por cupom`}
            />
            <CardKpi titulo="Ticket médio" valor={formatar.moeda(dia.totais.ticketMedio)} />
            <CardKpi
              titulo="Cancelados"
              valor={formatar.inteiro(dia.totais.canceladas)}
              detalhe={`${formatar.moeda(dia.totais.valorCancelado)} fora do faturamento`}
            />
          </div>

          {dia.formasDePagamento.length > 0 ? (
            <section className="space-y-4 rounded-xl border border-app-border bg-app-surface p-6">
              <h3 className="text-sm font-medium uppercase tracking-wider text-app-muted">
                Meios de pagamento
              </h3>
              <BarrasHorizontais
                itens={dia.formasDePagamento.map((forma) => ({
                  chave: forma.especie,
                  rotulo: forma.especie,
                  valor: forma.valor,
                  detalhe: `${formatar.percentual(forma.participacaoPct)} do recebido`,
                }))}
              />
            </section>
          ) : null}

          <section className="space-y-3 rounded-xl border border-app-border bg-app-surface p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-medium uppercase tracking-wider text-app-muted">
                Cupons ({formatar.inteiro(dia.paginacao.total)})
              </h3>
              {me.permissions.includes('reports.export') ? (
                <Link
                  href={`/api/exportar/vendas?${consulta.toString()}`}
                  prefetch={false}
                  className="rounded-lg border border-app-border px-3 py-2 text-sm text-app-fg transition hover:bg-app-hover"
                >
                  Exportar CSV
                </Link>
              ) : null}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-app-muted">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Hora</th>
                    <th className="py-2 pr-4 font-medium">Filial</th>
                    <th className="py-2 pr-4 font-medium">Caixa</th>
                    <th className="py-2 pr-4 font-medium">Cupom</th>
                    <th className="py-2 pr-4 font-medium">Itens</th>
                    <th className="py-2 pr-4 font-medium">Pagamento</th>
                    <th className="py-2 pr-4 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border text-app-fg">
                  {dia.cupons.map((cupom) => (
                    <tr
                      key={`${cupom.filialErpId}-${cupom.caixa}-${cupom.cupom}`}
                      className={cupom.cancelada ? 'text-app-muted line-through' : undefined}
                    >
                      <td className="py-2 pr-4 tabular-nums">{cupom.horario ?? '—'}</td>
                      <td className="py-2 pr-4">{cupom.filialNome}</td>
                      <td className="py-2 pr-4 tabular-nums">{cupom.caixa}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {cupom.cupom}
                        {cupom.cancelada ? (
                          <span className="ml-2 text-xs text-app-danger no-underline">
                            cancelado
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{cupom.itens}</td>
                      <td className="py-2 pr-4">{cupom.formas.join(' + ') || '—'}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatar.moeda(cupom.valorTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {dia.paginacao.paginas > 1 ? (
              <nav className="flex items-center justify-between text-sm" aria-label="Paginação">
                {dia.paginacao.pagina > 1 ? (
                  <Link
                    href={paginaUrl(dia.paginacao.pagina - 1)}
                    className="text-app-accent underline-offset-4 hover:underline"
                  >
                    ← Página anterior
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-app-muted">
                  Página {dia.paginacao.pagina} de {dia.paginacao.paginas}
                </span>
                {dia.paginacao.pagina < dia.paginacao.paginas ? (
                  <Link
                    href={paginaUrl(dia.paginacao.pagina + 1)}
                    className="text-app-accent underline-offset-4 hover:underline"
                  >
                    Próxima página →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}
