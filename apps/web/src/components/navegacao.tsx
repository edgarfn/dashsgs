import Link from 'next/link';
import { type MeResponse } from '@dashsgs/shared';
import { logoutAction } from '@/app/(auth)/actions';

/**
 * Cabeçalho comum às telas do produto (doc 16 §1).
 *
 * Cada atalho aparece só para quem o backend deixaria entrar: o front esconde o que já foi
 * negado, nunca decide permissão por conta própria (doc 07 §1).
 */
export function Cabecalho({ me, ativo }: { me: MeResponse; ativo?: string }) {
  const tenant = me.memberships.find((membership) => membership.tenantId === me.activeTenantId);

  const secoes = [
    { href: '/', rotulo: 'Visão Geral', chave: 'home', visivel: true },
    {
      href: '/vendas',
      rotulo: 'Vendas',
      chave: 'vendas',
      visivel: me.permissions.includes('dashboard.view'),
    },
    {
      href: '/estoque',
      rotulo: 'Estoque',
      chave: 'estoque',
      visivel: me.permissions.includes('dashboard.view'),
    },
    {
      href: '/alertas',
      rotulo: 'Alertas',
      chave: 'alertas',
      visivel: me.permissions.includes('alerts.ack'),
    },
  ].filter((secao) => secao.visivel);

  const administracao = [
    {
      href: '/admin/usuarios',
      rotulo: 'Usuários',
      visivel: me.permissions.includes('users.manage'),
    },
    {
      href: '/admin/conexao-erp',
      rotulo: 'Conexão ERP',
      visivel: me.permissions.includes('erp_connection.manage'),
    },
    {
      href: '/admin/sincronizacao',
      rotulo: 'Sincronização',
      visivel: me.permissions.includes('erp_connection.manage'),
    },
    { href: '/plataforma', rotulo: 'Plataforma', visivel: me.user.platformAdmin },
  ].filter((item) => item.visivel);

  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
            {tenant?.tenantName ?? 'Sem tenant selecionado'}
          </p>
          <h1 className="text-2xl font-semibold text-white">Olá, {me.user.name.split(' ')[0]}</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {administracao.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5"
            >
              {item.rotulo}
            </Link>
          ))}
          <Link
            href="/perfil"
            className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5"
          >
            Perfil
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5"
            >
              Sair
            </button>
          </form>
        </div>
      </div>

      <nav aria-label="Seções do produto">
        <ul className="flex flex-wrap gap-1 border-b border-white/10">
          {secoes.map((secao) => (
            <li key={secao.chave}>
              <Link
                href={secao.href}
                aria-current={ativo === secao.chave ? 'page' : undefined}
                className={`inline-block border-b-2 px-3 py-2 text-sm transition ${
                  ativo === secao.chave
                    ? 'border-sky-400 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {secao.rotulo}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

/**
 * Filtros globais como formulário GET (doc 16 §4).
 *
 * Sem JavaScript de página: a submissão vira query string, a query string vira link
 * compartilhável, e o link compartilhável é exatamente o que o doc pede. Também é o que mantém
 * a tela utilizável no celular do chão de loja, onde a conexão é ruim.
 */
export function FiltrosGlobais({
  filiais,
  selecionadas,
  children,
}: {
  filiais: Array<{ erpId: number; nome: string }>;
  selecionadas?: string;
  children?: React.ReactNode;
}) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4"
    >
      {filiais.length > 1 ? (
        <div className="space-y-1.5">
          <label htmlFor="filtro-filiais" className="block text-xs text-slate-400">
            Filial
          </label>
          <select
            id="filtro-filiais"
            name="filiais"
            defaultValue={selecionadas ?? ''}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400/60"
          >
            <option value="" className="bg-slate-900">
              Todas as filiais
            </option>
            {filiais.map((filial) => (
              <option key={filial.erpId} value={String(filial.erpId)} className="bg-slate-900">
                {filial.nome}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {children}

      <button
        type="submit"
        className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5"
      >
        Aplicar
      </button>
    </form>
  );
}
