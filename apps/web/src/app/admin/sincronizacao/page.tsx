import Link from 'next/link';
import { Alert } from '@/components/ui';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';
import { BackfillForm, RessincronizarForm } from './forms';

export const metadata = { title: 'Sincronização — DashSGS' };
export const dynamic = 'force-dynamic';

interface Escopo {
  filialErpId: number;
  filialNome: string | null;
  status: 'idle' | 'running' | 'error' | 'nunca';
  ultimoSucesso: string | null;
  atrasoSegundos: number | null;
  atrasado: boolean;
  watermarkDate: string | null;
  ultimoErro: string | null;
}

interface Dominio {
  domain: string;
  label: string;
  descricao: string;
  porFilial: boolean;
  escopos: Escopo[];
}

interface Execucao {
  id: string;
  domain: string;
  filialNome: string | null;
  trigger: string;
  startedAt: string;
  status: string;
  items: number;
  apiCalls: number;
  invalid: number;
  durationMs: number | null;
  error: string | null;
}

interface Painel {
  dominios: Dominio[];
  execucoes: Execucao[];
  backfill: { ativo: boolean; percentual: number; plano: { totalDias: number } | null };
  atrasoMaximoSegundos: number | null;
}

const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** "há 3 min" diz mais que um carimbo de data para quem quer saber se o painel está fresco. */
function desde(segundos: number | null): string {
  if (segundos === null) return 'nunca';
  if (segundos < 90) return 'agora há pouco';
  if (segundos < 5_400) return `há ${Math.round(segundos / 60)} min`;
  if (segundos < 172_800) return `há ${Math.round(segundos / 3_600)} h`;
  return `há ${Math.round(segundos / 86_400)} dias`;
}

const SELO = {
  idle: { rotulo: 'em dia', estilo: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30' },
  running: { rotulo: 'rodando', estilo: 'bg-sky-500/10 text-sky-300 ring-sky-500/30' },
  error: { rotulo: 'com erro', estilo: 'bg-rose-500/10 text-rose-300 ring-rose-500/30' },
  nunca: { rotulo: 'nunca rodou', estilo: 'bg-slate-500/10 text-slate-300 ring-slate-500/30' },
} as const;

/**
 * Admin → Sincronização (doc 26 §Status / E5-12).
 *
 * A tela responde a uma pergunta só: **os números que estou vendo estão atualizados?** Por isso o
 * frescor aparece por domínio e por filial — uma rede pode ter a loja do centro em dia e a do
 * bairro parada há dois dias, e um "tudo certo" genérico esconderia exatamente isso.
 */
export default async function SincronizacaoPage() {
  const me = await requireMe();

  if (!me.permissions.includes('erp_connection.manage')) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-white">Sem acesso a esta área</h1>
        <Alert kind="info">
          A sincronização é acompanhada por quem administra o tenant. Fale com o owner da sua rede.
        </Alert>
        <Link href="/" className="text-sm text-sky-300 underline-offset-4 hover:underline">
          Voltar para a home
        </Link>
      </main>
    );
  }

  const resposta = await apiRequest<Painel>('GET', '/tenant/sync');
  const painel = resposta.data;

  const algumAtrasado = painel?.dominios.some((dominio) =>
    dominio.escopos.some((escopo) => escopo.atrasado),
  );

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-xs uppercase tracking-[0.2em] text-slate-500 hover:text-slate-300"
        >
          DashSGS
        </Link>
        <h1 className="text-2xl font-semibold text-white">Sincronização</h1>
        <p className="text-sm text-slate-400">
          De quanto em quanto tempo cada informação é buscada no seu ERP, e quando ela chegou pela
          última vez.
        </p>
      </header>

      {!painel ? (
        <Alert kind="error">
          Não foi possível ler o estado da sincronização. Tente novamente em alguns instantes.
        </Alert>
      ) : null}

      {algumAtrasado ? (
        <Alert kind="info">
          Há informação atrasada. Isso costuma ser o ERP fora do ar ou uma rota que saiu do contrato
          com a SG — confira a{' '}
          <Link href="/admin/conexao-erp" className="underline underline-offset-4">
            conexão com o ERP
          </Link>
          .
        </Alert>
      ) : null}

      <section className="space-y-4">
        {painel?.dominios.map((dominio) => (
          <article
            key={dominio.domain}
            className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-6"
          >
            <div className="space-y-1">
              <h2 className="text-base font-medium text-white">{dominio.label}</h2>
              <p className="text-sm text-slate-400">{dominio.descricao}</p>
            </div>

            <ul className="divide-y divide-white/5">
              {dominio.escopos.map((escopo) => (
                <li
                  key={`${dominio.domain}-${escopo.filialErpId}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm text-slate-200">
                      {dominio.porFilial
                        ? (escopo.filialNome ?? `Filial ${escopo.filialErpId}`)
                        : 'Toda a rede'}
                    </p>
                    <p className="text-xs text-slate-500">
                      Atualizado {desde(escopo.atrasoSegundos)}
                      {escopo.ultimoSucesso
                        ? ` · ${dataHora.format(new Date(escopo.ultimoSucesso))}`
                        : ''}
                      {escopo.watermarkDate ? ` · até ${escopo.watermarkDate}` : ''}
                    </p>
                    {escopo.ultimoErro ? (
                      <p className="text-xs text-rose-300">Última falha: {escopo.ultimoErro}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                        escopo.atrasado && escopo.status !== 'running'
                          ? SELO.error.estilo
                          : SELO[escopo.status].estilo
                      }`}
                    >
                      {escopo.atrasado && escopo.status === 'idle'
                        ? 'atrasado'
                        : SELO[escopo.status].rotulo}
                    </span>

                    <RessincronizarForm
                      domain={dominio.domain}
                      filialErpId={escopo.filialErpId}
                      rotulo="Sincronizar agora"
                    />
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <div className="space-y-1">
          <h2 className="text-base font-medium text-white">Histórico</h2>
          <p className="text-sm text-slate-400">
            O dia a dia entra sozinho. Para ver comparativos com meses anteriores, é preciso trazer
            o histórico uma vez.
          </p>
        </div>

        <BackfillForm
          ativo={painel?.backfill.ativo ?? false}
          percentual={painel?.backfill.percentual ?? 0}
        />
      </section>

      <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
          Últimas execuções
        </h2>

        {painel && painel.execucoes.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Quando</th>
                  <th className="py-2 pr-4 font-medium">O quê</th>
                  <th className="py-2 pr-4 font-medium">Resultado</th>
                  <th className="py-2 pr-4 font-medium">Linhas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {painel.execucoes.map((execucao) => (
                  <tr key={execucao.id}>
                    <td className="py-2 pr-4 text-slate-400">
                      {dataHora.format(new Date(execucao.startedAt))}
                    </td>
                    <td className="py-2 pr-4">
                      {execucao.domain}
                      {execucao.filialNome ? ` · ${execucao.filialNome}` : ''}
                      <span className="text-slate-500"> ({execucao.trigger})</span>
                    </td>
                    <td className="py-2 pr-4">
                      {execucao.status}
                      {execucao.error ? (
                        <span className="block text-xs text-rose-300">{execucao.error}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {execucao.items}
                      {execucao.invalid > 0 ? (
                        <span className="text-amber-300"> ({execucao.invalid} em quarentena)</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            Nenhuma execução ainda. Assim que a conexão estiver testada, a sincronização começa
            sozinha.
          </p>
        )}
      </section>
    </main>
  );
}
