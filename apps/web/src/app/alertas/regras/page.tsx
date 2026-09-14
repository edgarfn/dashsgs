import Link from 'next/link';
import { Alert } from '@/components/ui';
import { Cabecalho } from '@/components/navegacao';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';
import { AjustarRegraForm, AlternarRegraForm } from '../forms';

export const metadata = { title: 'Avisos — DashSGS' };
export const dynamic = 'force-dynamic';

interface RegraView {
  id: string;
  name: string;
  type: string;
  severity: 'critica' | 'alta' | 'media' | 'baixa';
  params: Record<string, number>;
  canalEmail: boolean;
  audiencia: string;
  enabled: boolean;
  descricao: string;
  disponivel: boolean;
  dependencia?: string;
}

const SEVERIDADE_LABEL = {
  critica: 'crítica',
  alta: 'alta',
  media: 'média',
  baixa: 'baixa',
} as const;

const AUDIENCIA_LABEL: Record<string, string> = {
  operacao: 'gerentes e administradores',
  administracao: 'administradores do tenant',
};

/**
 * Alertas — Regras (doc 16 §2 / E8-04).
 *
 * Cada aviso mostra o que observa, quem recebe e com que limiar. As regras que dependem de dado
 * ainda não sincronizado aparecem **desabilitadas com o motivo** em vez de sumirem: sumir faria o
 * cliente pensar que o produto não cobre aquilo; dizer "depende da sincronização financeira"
 * informa o que falta e quando chega.
 */
export default async function RegrasPage() {
  const me = await requireMe();

  if (!me.permissions.includes('alerts.manage')) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-12">
        <Cabecalho me={me} ativo="alertas" />
        <Alert kind="info">
          Configurar avisos é tarefa de quem administra a rede. Você continua recebendo e
          reconhecendo os alertas no feed.
        </Alert>
        <Link href="/alertas" className="text-sm text-sky-300 underline-offset-4 hover:underline">
          Voltar para o feed
        </Link>
      </main>
    );
  }

  const resposta = await apiRequest<RegraView[]>('GET', '/alertas/regras');
  const regras = resposta.data ?? [];

  const ativas = regras.filter((regra) => regra.disponivel);
  const aguardando = regras.filter((regra) => !regra.disponivel);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-6 py-12">
      <Cabecalho me={me} ativo="alertas" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-medium text-white">Avisos</h2>
          <p className="text-sm text-slate-400">
            O DashSGS verifica estas condições a cada 5 minutos e avisa no feed e por e-mail.
          </p>
        </div>
        <Link href="/alertas" className="text-sm text-sky-300 underline-offset-4 hover:underline">
          Ver o feed
        </Link>
      </div>

      {!resposta.ok ? (
        <Alert kind="error">Não foi possível carregar os avisos configurados.</Alert>
      ) : null}

      <section className="space-y-4">
        {ativas.map((regra) => (
          <article
            key={regra.id}
            className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-medium text-white">{regra.name}</h3>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-400">
                    severidade {SEVERIDADE_LABEL[regra.severity]}
                  </span>
                  {regra.enabled ? (
                    <span className="text-xs text-emerald-300">✔ ligado</span>
                  ) : (
                    <span className="text-xs text-slate-500">• desligado</span>
                  )}
                </div>
                <p className="text-sm text-slate-400">{regra.descricao}</p>
                <p className="text-xs text-slate-500">
                  Enviado para {AUDIENCIA_LABEL[regra.audiencia] ?? regra.audiencia}.
                </p>
              </div>

              <AlternarRegraForm id={regra.id} ligada={regra.enabled} />
            </div>

            {regra.enabled ? (
              <AjustarRegraForm id={regra.id} params={regra.params} canalEmail={regra.canalEmail} />
            ) : null}
          </article>
        ))}
      </section>

      {aguardando.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-dashed border-white/15 bg-white/[0.01] p-6">
          <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">
            Aguardando dados
          </h3>
          <p className="text-sm text-slate-400">
            Estes avisos já existem no produto, mas dependem de informação que ainda não é trazida
            do seu ERP. Eles ligam sozinhos quando a sincronização correspondente entrar.
          </p>
          <ul className="space-y-2 text-sm text-slate-300">
            {aguardando.map((regra) => (
              <li key={regra.id} className="flex flex-wrap justify-between gap-2">
                <span>{regra.name}</span>
                <span className="text-xs text-slate-500">depende de {regra.dependencia}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
