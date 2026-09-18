import Link from 'next/link';
import { Alert } from '@/components/ui';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';
import { ConexaoForm, TestarConexaoForm } from './forms';

export const metadata = { title: 'Conexão com o ERP — DashSGS' };
export const dynamic = 'force-dynamic';

interface ConexaoView {
  configurada: boolean;
  baseUrl: string | null;
  isSgCloud: boolean;
  tlsMode: 'https' | 'vpn';
  username: string | null;
  senhaCadastrada: boolean;
  maxRps: number;
  apiPathPrefix: string;
  authHeaderMode: 'raw' | 'bearer';
  pageSize: number | null;
  pageSizePorRota: Record<string, number>;
  status: 'pending' | 'ok' | 'error';
  lastError: string | null;
  lastHealthAt: string | null;
  health: { versao: string | null; revisao: string | null; razaoSocial: string | null } | null;
  routesGranted: string[];
  routesCheckedAt: string | null;
}

const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const ESTADO = {
  ok: { rotulo: 'conectado', estilo: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30' },
  pending: { rotulo: 'não testado', estilo: 'bg-amber-500/10 text-amber-300 ring-amber-500/30' },
  error: { rotulo: 'com erro', estilo: 'bg-rose-500/10 text-rose-300 ring-rose-500/30' },
} as const;

/**
 * Admin → Conexão ERP (doc 16 §2 e runbook 22 §1, passo 2).
 *
 * É a tela que liga o DashSGS ao ERP do cliente. Duas decisões de produto aparecem aqui: a senha
 * é write-only (nunca volta, nem mascarada) e o estado só vira "conectado" depois de um teste
 * real — configurar não é o mesmo que funcionar.
 */
export default async function ConexaoErpPage() {
  const me = await requireMe();

  if (!me.permissions.includes('erp_connection.manage')) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-white">Sem acesso a esta área</h1>
        <Alert kind="info">
          A conexão com o ERP é administrada por quem cuida do tenant. Fale com o owner da sua rede.
        </Alert>
        <Link href="/" className="text-sm text-sky-300 underline-offset-4 hover:underline">
          Voltar para a home
        </Link>
      </main>
    );
  }

  const resposta = await apiRequest<ConexaoView>('GET', '/tenant/erp-connection');

  // A API exige MFA recente para esta área; a tela explica em vez de mostrar erro cru.
  if (resposta.status === 401) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-white">Verificação necessária</h1>
        <Alert kind="info">
          Esta área mexe na credencial de acesso ao seu ERP e exige verificação em duas etapas
          recente. Entre novamente para continuar.
        </Alert>
        <Link href="/perfil" className="text-sm text-sky-300 underline-offset-4 hover:underline">
          Ir para o perfil
        </Link>
      </main>
    );
  }

  const conexao = resposta.data;
  const estado = ESTADO[conexao?.status ?? 'pending'];

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-xs uppercase tracking-[0.2em] text-slate-500 hover:text-slate-300"
        >
          DashSGS
        </Link>
        <h1 className="text-2xl font-semibold text-white">Conexão com o ERP</h1>
        <p className="text-sm text-slate-400">
          O DashSGS lê os dados do seu ERP SG por esta conexão. Nada é enviado ao ERP sem que você
          peça.
        </p>
      </header>

      <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Estado</h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${estado.estilo}`}
          >
            {estado.rotulo}
          </span>
        </div>

        {conexao?.status === 'error' && conexao.lastError ? (
          <Alert kind="error">
            Último teste falhou: {conexao.lastError}. Confira o endereço, o usuário e a senha
            fornecidos pela SG.
          </Alert>
        ) : null}

        {conexao?.health ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">Instalação</dt>
              <dd className="text-slate-200">{conexao.health.razaoSocial ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">Versão do ERP</dt>
              <dd className="text-slate-200">
                {conexao.health.versao ?? '—'}
                {conexao.health.revisao ? ` · rev ${conexao.health.revisao}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">Último teste</dt>
              <dd className="text-slate-200">
                {conexao.lastHealthAt ? dataHora.format(new Date(conexao.lastHealthAt)) : '—'}
              </dd>
            </div>
          </dl>
        ) : null}

        <TestarConexaoForm />
      </section>

      {conexao && conexao.routesGranted.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
            Rotas contratadas ({conexao.routesGranted.length})
          </h2>
          <p className="text-sm text-slate-400">
            É o que o seu contrato com a SG libera. O DashSGS só oferece os painéis cobertos por
            estas rotas — o resto aparece desabilitado, com o motivo.
          </p>
          <ul className="flex flex-wrap gap-2">
            {conexao.routesGranted.map((rota) => (
              <li
                key={rota}
                className="rounded-full bg-white/5 px-3 py-1 font-mono text-xs text-slate-300"
              >
                {rota}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
          {conexao?.configurada ? 'Editar conexão' : 'Configurar conexão'}
        </h2>

        <ConexaoForm
          atual={{
            baseUrl: conexao?.baseUrl ?? '',
            username: conexao?.username ?? '',
            isSgCloud: conexao?.isSgCloud ?? false,
            tlsMode: conexao?.tlsMode ?? 'https',
            maxRps: conexao?.maxRps ?? 4,
            apiPathPrefix: conexao?.apiPathPrefix ?? '',
            authHeaderMode: conexao?.authHeaderMode ?? 'raw',
            pageSize: conexao?.pageSize ?? null,
            pageSizePorRota: conexao?.pageSizePorRota ?? {},
            senhaCadastrada: conexao?.senhaCadastrada ?? false,
          }}
        />
      </section>
    </main>
  );
}
