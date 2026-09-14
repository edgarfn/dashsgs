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

export const metadata = { title: 'Financeiro — DashSGS' };
export const dynamic = 'force-dynamic';

interface Aging {
  tipo: 'pagar' | 'receber';
  total: number;
  buckets: Array<{ bucket: string; rotulo: string; valor: number; parcelas: number }>;
}

interface FinanceiroView {
  aging: { pagar: Aging; receber: Aging };
  fluxo: Array<{ semana: string; pagar: number; receber: number; saldo: number }>;
  despesas: {
    total: number;
    porTipo: Array<{
      tipoErpId: string | null;
      descricao: string;
      classificacao: string | null;
      valor: number;
      participacaoPct: number;
    }>;
    fixasPct: number | null;
  };
  cartoes: {
    volumeBruto: number;
    valorTaxas: number;
    taxaMediaPct: number | null;
    porBandeira: Array<{
      bandeira: string;
      adquirente: string | null;
      volume: number;
      taxaMediaPct: number | null;
      transacoes: number;
    }>;
    naoConciliados: { transacoes: number; valor: number };
  };
  periodo: { de: string; ate: string };
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

/** Aging em barras: "vencido" ganha destaque porque é a faixa que exige ação hoje. */
function AgingBlocos({ aging }: { aging: Aging }) {
  const titulo = aging.tipo === 'pagar' ? 'A pagar' : 'A receber';

  return (
    <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">{titulo}</h3>
        <span className="text-lg font-semibold tabular-nums text-white">
          {formatar.moeda(aging.total)}
        </span>
      </div>

      <ul className="space-y-3">
        {aging.buckets.map((faixa) => {
          const vencido = faixa.bucket === 'vencido';

          return (
            <li key={faixa.bucket} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className={vencido ? 'text-rose-300' : 'text-slate-200'}>
                  {vencido ? '⚠ ' : ''}
                  {faixa.rotulo}
                </span>
                <span className="tabular-nums text-slate-300">
                  {formatar.moeda(faixa.valor)}
                  <span className="ml-2 text-xs text-slate-500">
                    {faixa.parcelas} {faixa.parcelas === 1 ? 'parcela' : 'parcelas'}
                  </span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  data-barra
                  className={`h-full rounded-full medida-largura ${classeProporcao(
                    faixa.valor,
                    aging.total,
                  )} ${vencido ? 'bg-rose-500/70' : 'bg-sky-500/70'}`}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Financeiro — aging, fluxo, despesas e cartões (doc 15 §5 / E7-08).
 *
 * É a tela mais sensível do produto: mostra a dívida, o custo fixo e o que a operadora de cartão
 * ainda não repassou. Por isso ela é de manager+ — a API recusa quem não tem papel de gestão, e
 * aqui a recusa vira uma explicação em vez de um erro cru.
 */
export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireMe();
  const params = await searchParams;

  const texto = (chave: string) => (typeof params[chave] === 'string' ? params[chave] : undefined);
  const hoje = new Date().toISOString().slice(0, 10);
  const trintaDias = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);

  const de = texto('de') ?? trintaDias;
  const ate = texto('ate') ?? hoje;
  const filiaisParam = texto('filiais');

  const consulta = new URLSearchParams({ de, ate });
  if (filiaisParam) consulta.set('filiais', filiaisParam);

  const [resposta, filiais] = await Promise.all([
    apiRequest<FinanceiroView>('GET', `/dashboard/financeiro?${consulta.toString()}`),
    apiRequest<FilialView[]>('GET', '/dim/filiais'),
  ]);

  if (resposta.status === 403) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-12">
        <Cabecalho me={me} ativo="financeiro" />
        <Alert kind="info">
          O painel financeiro mostra dívida, custo e taxas da rede, e fica com quem tem papel de
          gestão (gerente, admin ou owner). Fale com o administrador se precisar do acesso.
        </Alert>
      </main>
    );
  }

  const dados = resposta.data;
  const semDados =
    dados !== null &&
    dados.aging.pagar.total === 0 &&
    dados.aging.receber.total === 0 &&
    dados.despesas.total === 0 &&
    dados.cartoes.volumeBruto === 0;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-12">
      <Cabecalho me={me} ativo="financeiro" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-white">Financeiro</h2>
        <div className="flex items-center gap-3">
          {dados ? <SeloDeFrescor frescor={dados.frescor} /> : null}
          <Link href="/compras" className="text-sm text-sky-300 underline-offset-4 hover:underline">
            Ver compras
          </Link>
        </div>
      </div>

      <FiltrosGlobais filiais={paraFiltro(filiais.data)} selecionadas={filiaisParam}>
        <div className="space-y-1.5">
          <label htmlFor="filtro-de" className="block text-xs text-slate-400">
            Despesas e cartões de
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
            até
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
        <Alert kind="error">Não foi possível carregar o financeiro agora.</Alert>
      ) : semDados ? (
        <EstadoVazio
          titulo="Ainda não há dados financeiros"
          descricao="Contas, despesas e cartões são sincronizados de hora em hora. Se a conexão acabou de ser configurada, eles aparecem no próximo ciclo."
          acao={
            me.permissions.includes('erp_connection.manage')
              ? { href: '/admin/sincronizacao', rotulo: 'Ver sincronização' }
              : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <AgingBlocos aging={dados.aging.pagar} />
            <AgingBlocos aging={dados.aging.receber} />
          </div>

          {dados.fluxo.length > 0 ? (
            <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-6">
              <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">
                Fluxo previsto por semana
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Semana de</th>
                      <th className="py-2 pr-4 text-right font-medium">A pagar</th>
                      <th className="py-2 pr-4 text-right font-medium">A receber</th>
                      <th className="py-2 pr-4 text-right font-medium">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {dados.fluxo.map((semana) => (
                      <tr key={semana.semana}>
                        <td className="py-2 pr-4 tabular-nums">
                          {formatar.dataCompleta(semana.semana)}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {formatar.moeda(semana.pagar)}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {formatar.moeda(semana.receber)}
                        </td>
                        <td
                          className={`py-2 pr-4 text-right tabular-nums ${
                            semana.saldo < 0 ? 'text-rose-300' : 'text-emerald-300'
                          }`}
                        >
                          {formatar.moeda(semana.saldo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">
                Despesas do período
              </h3>
              <span className="text-sm text-slate-400">
                {formatar.moeda(dados.despesas.total)}
                {dados.despesas.fixasPct !== null
                  ? ` · ${formatar.percentual(dados.despesas.fixasPct)} fixas`
                  : ''}
              </span>
            </div>
            <BarrasHorizontais
              itens={dados.despesas.porTipo.slice(0, 12).map((tipo) => ({
                chave: tipo.tipoErpId ?? tipo.descricao,
                rotulo: tipo.descricao,
                valor: tipo.valor,
                detalhe: `${formatar.percentual(tipo.participacaoPct)} do total${
                  tipo.classificacao ? ` · ${tipo.classificacao.toLowerCase()}` : ''
                }`,
              }))}
            />
          </section>

          <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
            <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">Cartões</h3>

            <div className="grid gap-4 sm:grid-cols-3">
              <CardKpi titulo="Volume bruto" valor={formatar.moeda(dados.cartoes.volumeBruto)} />
              <CardKpi
                titulo="Taxa média efetiva"
                valor={formatar.percentual(dados.cartoes.taxaMediaPct)}
                detalhe={`${formatar.moeda(dados.cartoes.valorTaxas)} em taxas`}
              />
              <CardKpi
                titulo="Não conciliados"
                valor={formatar.inteiro(dados.cartoes.naoConciliados.transacoes)}
                detalhe={`${formatar.moeda(dados.cartoes.naoConciliados.valor)} sem baixa há mais de 7 dias`}
              />
            </div>

            <BarrasHorizontais
              itens={dados.cartoes.porBandeira.map((linha) => ({
                chave: `${linha.bandeira}-${linha.adquirente ?? ''}`,
                rotulo: `${linha.bandeira}${linha.adquirente ? ` · ${linha.adquirente}` : ''}`,
                valor: linha.volume,
                detalhe: `${formatar.inteiro(linha.transacoes)} transações · taxa média ${formatar.percentual(linha.taxaMediaPct)}`,
              }))}
            />
            <p className="text-xs text-slate-500">
              A taxa média é ponderada pelo volume: uma transação de R$ 5 não pesa o mesmo que uma
              de R$ 5.000.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
