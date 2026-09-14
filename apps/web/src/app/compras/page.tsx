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

export const metadata = { title: 'Compras — DashSGS' };
export const dynamic = 'force-dynamic';

interface ComprasView {
  periodo: { de: string; ate: string };
  porSituacao: Array<{ situacao: string; pedidos: number; valor: number }>;
  leadTimeDias: { media: number | null; p90: number | null; atendidos: number };
  pendentesAntigos: Array<{
    erpId: number;
    filialNome: string | null;
    dataPedido: string | null;
    diasEmAberto: number;
    situacao: string | null;
    valorTotal: number;
  }>;
  entradas: { notas: number; valor: number };
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
 * Compras — pedidos, lead time e entradas (doc 15 §6 / E7-08).
 *
 * A pergunta da tela é "o que eu pedi e ainda não chegou?". Por isso os pendentes antigos vêm
 * listados um a um, com o número do pedido: é com ele que o comprador liga para o fornecedor.
 */
export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireMe();
  const params = await searchParams;

  if (!me.permissions.includes('dashboard.view')) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-12">
        <Cabecalho me={me} ativo="compras" />
        <Alert kind="info">Sua conta não tem acesso aos painéis desta rede.</Alert>
      </main>
    );
  }

  const texto = (chave: string) => (typeof params[chave] === 'string' ? params[chave] : undefined);
  const hoje = new Date().toISOString().slice(0, 10);
  const sessentaDias = new Date(Date.now() - 59 * 86_400_000).toISOString().slice(0, 10);

  const de = texto('de') ?? sessentaDias;
  const ate = texto('ate') ?? hoje;
  const filiaisParam = texto('filiais');

  const consulta = new URLSearchParams({ de, ate });
  if (filiaisParam) consulta.set('filiais', filiaisParam);

  const [resposta, filiais] = await Promise.all([
    apiRequest<ComprasView>('GET', `/dashboard/compras?${consulta.toString()}`),
    apiRequest<FilialView[]>('GET', '/dim/filiais'),
  ]);

  const dados = resposta.data;
  const totalPedidos = (dados?.porSituacao ?? []).reduce((total, item) => total + item.pedidos, 0);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-12">
      <Cabecalho me={me} ativo="compras" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-white">Compras</h2>
        <div className="flex items-center gap-3">
          {dados ? <SeloDeFrescor frescor={dados.frescor} /> : null}
          {me.permissions.includes('dashboard.view') ? (
            <Link
              href="/financeiro"
              className="text-sm text-sky-300 underline-offset-4 hover:underline"
            >
              Ver financeiro
            </Link>
          ) : null}
        </div>
      </div>

      <FiltrosGlobais filiais={paraFiltro(filiais.data)} selecionadas={filiaisParam}>
        <div className="space-y-1.5">
          <label htmlFor="filtro-de" className="block text-xs text-slate-400">
            Pedidos de
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
        <Alert kind="error">Não foi possível carregar as compras agora.</Alert>
      ) : totalPedidos === 0 && dados.entradas.notas === 0 ? (
        <EstadoVazio
          titulo="Nenhum pedido no período"
          descricao="Pedidos de compra e notas de entrada são sincronizados de hora em hora. Se a conexão acabou de ser configurada, eles aparecem no próximo ciclo."
          acao={
            me.permissions.includes('erp_connection.manage')
              ? { href: '/admin/sincronizacao', rotulo: 'Ver sincronização' }
              : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <CardKpi titulo="Pedidos no período" valor={formatar.inteiro(totalPedidos)} />
            <CardKpi
              titulo="Lead time médio"
              valor={
                dados.leadTimeDias.media === null
                  ? '—'
                  : `${formatar.decimal(dados.leadTimeDias.media)} dias`
              }
              detalhe={
                dados.leadTimeDias.p90 === null
                  ? `${dados.leadTimeDias.atendidos} pedidos atendidos`
                  : `p90 de ${formatar.decimal(dados.leadTimeDias.p90)} dias · ${dados.leadTimeDias.atendidos} atendidos`
              }
            />
            <CardKpi
              titulo="Pendentes antigos"
              valor={formatar.inteiro(dados.pendentesAntigos.length)}
              detalhe="sem atendimento há mais de 15 dias"
            />
            <CardKpi
              titulo="Entradas"
              valor={formatar.moeda(dados.entradas.valor)}
              detalhe={`${formatar.inteiro(dados.entradas.notas)} notas`}
            />
          </div>

          <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
            <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">
              Pedidos por situação
            </h3>
            <BarrasHorizontais
              itens={dados.porSituacao.map((linha) => ({
                chave: linha.situacao,
                rotulo: linha.situacao,
                valor: linha.valor,
                detalhe: `${formatar.inteiro(linha.pedidos)} ${linha.pedidos === 1 ? 'pedido' : 'pedidos'}`,
              }))}
            />
          </section>

          {dados.pendentesAntigos.length > 0 ? (
            <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-6">
              <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">
                Pedidos parados
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Pedido</th>
                      <th className="py-2 pr-4 font-medium">Filial</th>
                      <th className="py-2 pr-4 font-medium">Feito em</th>
                      <th className="py-2 pr-4 font-medium">Situação</th>
                      <th className="py-2 pr-4 text-right font-medium">Dias parado</th>
                      <th className="py-2 pr-4 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {dados.pendentesAntigos.map((pedido) => (
                      <tr key={pedido.erpId}>
                        <td className="py-2 pr-4 tabular-nums">#{pedido.erpId}</td>
                        <td className="py-2 pr-4">{pedido.filialNome ?? '—'}</td>
                        <td className="py-2 pr-4 tabular-nums">
                          {pedido.dataPedido ? formatar.dataCompleta(pedido.dataPedido) : '—'}
                        </td>
                        <td className="py-2 pr-4">{pedido.situacao ?? '—'}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-amber-300">
                          {pedido.diasEmAberto}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {formatar.moeda(pedido.valorTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">
                O lead time conta do pedido ao atendimento — não à previsão do fornecedor, que é
                promessa, não entrega.
              </p>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
