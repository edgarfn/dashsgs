import Link from 'next/link';
import { Alert } from '@/components/ui';
import { CardKpi, EstadoVazio, formatar } from '@/components/dashboard';
import { Cabecalho } from '@/components/navegacao';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';
import { AvaliarAgoraForm, ReconhecerForm } from './forms';

export const metadata = { title: 'Alertas — DashSGS' };
export const dynamic = 'force-dynamic';

interface EventoView {
  id: string;
  tipo: string;
  titulo: string;
  severidade: 'critica' | 'alta' | 'media' | 'baixa';
  status: 'open' | 'acknowledged' | 'resolved';
  filialErpId: number | null;
  resumo: string;
  link: string | null;
  criadoEm: string;
  reconhecidoEm: string | null;
}

interface FeedView {
  eventos: EventoView[];
  contagens: { abertos: number; reconhecidos: number; criticos: number };
  paginacao: { pagina: number; itensPorPagina: number; total: number; paginas: number };
}

const SEVERIDADE = {
  critica: { rotulo: 'crítica', estilo: 'bg-rose-500/10 text-rose-300 ring-rose-500/30' },
  alta: { rotulo: 'alta', estilo: 'bg-amber-500/10 text-amber-300 ring-amber-500/30' },
  media: { rotulo: 'média', estilo: 'bg-sky-500/10 text-sky-300 ring-sky-500/30' },
  baixa: { rotulo: 'baixa', estilo: 'bg-slate-500/10 text-slate-300 ring-slate-500/20' },
} as const;

const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Alertas — Feed (doc 16 §2 / E8-02).
 *
 * A lista é para agir: severidade primeiro, com o caminho para o contexto em cada item. O botão
 * "Reconhecer" marca que alguém assumiu — não que o problema acabou. Numa rede com vários
 * gerentes olhando o mesmo feed, essa diferença evita que dois resolvam a mesma coisa.
 */
export default async function AlertasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireMe();
  const params = await searchParams;

  if (!me.permissions.includes('alerts.ack')) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-12">
        <Cabecalho me={me} ativo="alertas" />
        <Alert kind="info">
          Sua conta acompanha os painéis, mas não recebe os alertas desta rede. Fale com o
          administrador.
        </Alert>
      </main>
    );
  }

  const status = typeof params.status === 'string' ? params.status : 'open';
  const consulta = new URLSearchParams();
  if (status !== 'todos') consulta.set('status', status);

  const resposta = await apiRequest<FeedView>('GET', `/alertas?${consulta.toString()}`);
  const feed = resposta.data;

  const filtro = (valor: string, rotulo: string) => (
    <Link
      key={valor}
      href={`/alertas?status=${valor}`}
      aria-current={status === valor ? 'page' : undefined}
      className={`rounded-lg border px-3 py-2 text-sm transition ${
        status === valor
          ? 'border-sky-400/60 bg-sky-500/10 text-white'
          : 'border-white/15 text-slate-300 hover:bg-white/5'
      }`}
    >
      {rotulo}
    </Link>
  );

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-6 py-12">
      <Cabecalho me={me} ativo="alertas" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-white">Alertas</h2>
        <div className="flex items-center gap-3">
          {me.permissions.includes('alerts.manage') ? (
            <>
              <AvaliarAgoraForm />
              <Link
                href="/alertas/regras"
                className="text-sm text-sky-300 underline-offset-4 hover:underline"
              >
                Configurar avisos
              </Link>
            </>
          ) : null}
        </div>
      </div>

      {feed ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <CardKpi titulo="Abertos" valor={formatar.inteiro(feed.contagens.abertos)} />
          <CardKpi
            titulo="Críticos abertos"
            valor={formatar.inteiro(feed.contagens.criticos)}
            detalhe="exigem ação imediata"
          />
          <CardKpi
            titulo="Reconhecidos"
            valor={formatar.inteiro(feed.contagens.reconhecidos)}
            detalhe="alguém já assumiu"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {filtro('open', 'Abertos')}
        {filtro('acknowledged', 'Reconhecidos')}
        {filtro('todos', 'Todos')}
      </div>

      {!feed ? (
        <Alert kind="error">Não foi possível carregar os alertas agora.</Alert>
      ) : feed.eventos.length === 0 ? (
        <EstadoVazio
          titulo={status === 'open' ? 'Nenhum alerta aberto 🎉' : 'Nada por aqui'}
          descricao={
            status === 'open'
              ? 'Ruptura, estoque negativo, divergência de fechamento, queda de venda e integração parada estão sendo verificados a cada 5 minutos. Quando algo fugir do esperado, aparece aqui e no e-mail.'
              : 'Nenhum alerta neste filtro.'
          }
          acao={
            me.permissions.includes('alerts.manage')
              ? { href: '/alertas/regras', rotulo: 'Ver os avisos configurados' }
              : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {feed.eventos.map((evento) => (
            <li
              key={evento.id}
              className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-5"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${SEVERIDADE[evento.severidade].estilo}`}
                  >
                    {SEVERIDADE[evento.severidade].rotulo}
                  </span>
                  <h3 className="text-base font-medium text-white">{evento.titulo}</h3>
                  {evento.status === 'acknowledged' ? (
                    <span className="text-xs text-slate-500">· reconhecido</span>
                  ) : null}
                </div>

                <p className="text-sm text-slate-300">{evento.resumo}</p>
                <p className="text-xs text-slate-500">
                  {dataHora.format(new Date(evento.criadoEm))}
                  {evento.reconhecidoEm
                    ? ` · reconhecido em ${dataHora.format(new Date(evento.reconhecidoEm))}`
                    : ''}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {evento.link ? (
                  <Link
                    href={evento.link}
                    className="text-sm text-sky-300 underline-offset-4 hover:underline"
                  >
                    Ver contexto
                  </Link>
                ) : null}
                {evento.status === 'open' ? <ReconhecerForm id={evento.id} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
