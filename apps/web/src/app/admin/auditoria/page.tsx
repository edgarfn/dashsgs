import {
  AUDIT_CATEGORIAS,
  AUDIT_CATEGORIA_LABEL,
  AUDIT_RESULTADOS,
  AUDIT_RESULTADO_LABEL,
  rotuloDaAcao,
  type AuditEntryView,
  type Paginated,
} from '@dashsgs/shared';
import Link from 'next/link';
import { Alert } from '@/components/ui';
import { EstadoVazio } from '@/components/dashboard';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';

export const metadata = { title: 'Auditoria — DashSGS' };
export const dynamic = 'force-dynamic';

interface Membro {
  membershipId: string;
  user: { id: string; name: string; email: string };
}

const quando = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'America/Sao_Paulo',
});

const CORES_DO_RESULTADO: Record<string, string> = {
  success: 'text-app-fg',
  denied: 'text-app-warning',
  error: 'text-app-danger',
};

/** Converte o objeto de mudanças em linhas legíveis, sem despejar JSON cru na cara do auditor. */
function detalhes(changes: Record<string, unknown> | null): Array<[string, string]> {
  if (!changes) return [];
  return Object.entries(changes).map(([chave, valor]) => [
    chave,
    typeof valor === 'object' && valor !== null ? JSON.stringify(valor) : String(valor),
  ]);
}

/**
 * Admin → Auditoria (E6-01, doc 16 §2).
 *
 * A tela responde três perguntas, nesta ordem: *quem fez*, *o quê* e *deu certo?*. Por isso a
 * primeira coluna é a pessoa e não o horário — o horário é como se ordena, não como se procura.
 *
 * Cada linha traz o rótulo em português e o código do evento em seguida: o rótulo serve a quem
 * audita, o código serve a quem abre um chamado conosco. Esconder o código transformaria toda
 * conversa de suporte em adivinhação.
 */
export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireMe();
  const params = await searchParams;

  if (!me.permissions.includes('audit.view')) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-6 py-16">
        <h1 className="text-2xl font-semibold text-app-fg">Sem acesso a esta área</h1>
        <Alert kind="info">
          A trilha de auditoria é restrita a quem administra a rede e ao papel de auditoria. Fale
          com o owner da sua rede se precisar deste acesso.
        </Alert>
        <Link href="/" className="text-sm text-app-accent underline-offset-4 hover:underline">
          Voltar para a home
        </Link>
      </main>
    );
  }

  const texto = (chave: string) => (typeof params[chave] === 'string' ? params[chave] : undefined);

  const consulta = new URLSearchParams();
  for (const chave of ['de', 'ate', 'acao', 'categoria', 'resultado', 'atorId', 'page']) {
    const valor = texto(chave);
    if (valor) consulta.set(chave, valor);
  }

  const [trilha, acoes, membros] = await Promise.all([
    apiRequest<Paginated<AuditEntryView>>('GET', `/tenant/audit?${consulta.toString()}`),
    apiRequest<string[]>('GET', '/tenant/audit/acoes'),
    // `users.manage` é outra permissão: um auditor puro não lista membros, e o filtro por pessoa
    // simplesmente não aparece para ele.
    me.permissions.includes('users.manage')
      ? apiRequest<Membro[]>('GET', '/tenant/users')
      : Promise.resolve({ data: null, error: null }),
  ]);

  const dados = trilha.data;
  const tenant = me.memberships.find((item) => item.tenantId === me.activeTenantId);

  // O export leva os mesmos filtros da tela — menos a paginação, porque o arquivo é o período.
  const exportacao = new URLSearchParams(consulta);
  exportacao.delete('page');

  const paginaAtual = dados?.page ?? 1;
  const linkDePagina = (pagina: number) => {
    const alvo = new URLSearchParams(consulta);
    alvo.set('page', String(pagina));
    return `/admin/auditoria?${alvo.toString()}`;
  };

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-12">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-xs uppercase tracking-[0.2em] text-app-muted hover:text-app-fg"
        >
          {tenant?.tenantName ?? 'DashSGS'}
        </Link>
        <h1 className="text-2xl font-semibold text-app-fg">Auditoria</h1>
        <p className="text-sm text-app-muted">
          Registro do que aconteceu nesta rede: acessos, mudanças de papel, alterações da conexão
          com o ERP e operações sobre os dados.
        </p>
      </header>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-app-border bg-app-surface p-4"
      >
        <div className="space-y-1.5">
          <label htmlFor="filtro-de" className="block text-xs text-app-muted">
            De
          </label>
          <input
            id="filtro-de"
            type="date"
            name="de"
            defaultValue={texto('de')}
            className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-fg outline-none focus:border-app-accent/60"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="filtro-ate" className="block text-xs text-app-muted">
            até
          </label>
          <input
            id="filtro-ate"
            type="date"
            name="ate"
            defaultValue={texto('ate')}
            className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-fg outline-none focus:border-app-accent/60"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="filtro-categoria" className="block text-xs text-app-muted">
            Categoria
          </label>
          <select
            id="filtro-categoria"
            name="categoria"
            defaultValue={texto('categoria') ?? ''}
            className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-fg outline-none focus:border-app-accent/60"
          >
            <option value="" className="bg-app-bg">
              Todas
            </option>
            {AUDIT_CATEGORIAS.map((categoria) => (
              <option key={categoria} value={categoria} className="bg-app-bg">
                {AUDIT_CATEGORIA_LABEL[categoria]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="filtro-acao" className="block text-xs text-app-muted">
            Evento
          </label>
          <select
            id="filtro-acao"
            name="acao"
            defaultValue={texto('acao') ?? ''}
            className="max-w-[16rem] rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-fg outline-none focus:border-app-accent/60"
          >
            <option value="" className="bg-app-bg">
              Todos
            </option>
            {/* Só o que de fato já aconteceu nesta rede: oferecer filtro que devolve vazio
                sempre é ensinar o usuário a não confiar no filtro. */}
            {(acoes.data ?? []).map((acao) => (
              <option key={acao} value={acao} className="bg-app-bg">
                {rotuloDaAcao(acao)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="filtro-resultado" className="block text-xs text-app-muted">
            Resultado
          </label>
          <select
            id="filtro-resultado"
            name="resultado"
            defaultValue={texto('resultado') ?? ''}
            className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-fg outline-none focus:border-app-accent/60"
          >
            <option value="" className="bg-app-bg">
              Todos
            </option>
            {AUDIT_RESULTADOS.map((resultado) => (
              <option key={resultado} value={resultado} className="bg-app-bg">
                {AUDIT_RESULTADO_LABEL[resultado]}
              </option>
            ))}
          </select>
        </div>

        {membros.data ? (
          <div className="space-y-1.5">
            <label htmlFor="filtro-ator" className="block text-xs text-app-muted">
              Pessoa
            </label>
            <select
              id="filtro-ator"
              name="atorId"
              defaultValue={texto('atorId') ?? ''}
              className="max-w-[14rem] rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-fg outline-none focus:border-app-accent/60"
            >
              <option value="" className="bg-app-bg">
                Todas
              </option>
              {membros.data.map((membro) => (
                <option key={membro.user.id} value={membro.user.id} className="bg-app-bg">
                  {membro.user.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <button
          type="submit"
          className="rounded-lg bg-app-accent/90 px-4 py-2 text-sm font-medium text-app-accent-fg hover:bg-app-accent"
        >
          Aplicar
        </button>

        <Link
          href="/admin/auditoria"
          className="px-2 py-2 text-sm text-app-muted underline-offset-4 hover:text-app-fg hover:underline"
        >
          Limpar
        </Link>
      </form>

      {!dados ? (
        <Alert kind="error">Não foi possível carregar a trilha agora.</Alert>
      ) : dados.data.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum evento no recorte"
          descricao="Ajuste o período ou limpe os filtros. A trilha guarda cinco anos de histórico e nada nela é apagado antes disso."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-sm text-app-muted">
              {dados.totalItems.toLocaleString('pt-BR')}{' '}
              {dados.totalItems === 1 ? 'evento' : 'eventos'} no recorte
            </p>
            <a
              href={`/api/exportar/auditoria?${exportacao.toString()}`}
              className="text-sm text-app-accent underline-offset-4 hover:underline"
            >
              Exportar CSV
            </a>
          </div>

          <div className="overflow-x-auto rounded-xl border border-app-border bg-app-surface">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-app-muted">
                <tr className="border-b border-app-border">
                  <th className="px-4 py-3 font-medium">Pessoa</th>
                  <th className="px-4 py-3 font-medium">Evento</th>
                  <th className="px-4 py-3 font-medium">Resultado</th>
                  <th className="px-4 py-3 font-medium">Recurso</th>
                  <th className="px-4 py-3 font-medium">Quando</th>
                  <th className="px-4 py-3 font-medium">Origem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border text-app-fg">
                {dados.data.map((evento) => (
                  <tr key={evento.id} className="align-top">
                    <td className="px-4 py-3">
                      {evento.ator ? (
                        <>
                          <span className="block text-app-fg">{evento.ator.nome}</span>
                          <span className="block text-xs text-app-muted">{evento.ator.email}</span>
                        </>
                      ) : (
                        <span className="text-app-muted">não identificado</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-app-fg">
                        {/* Marca antes do texto: cor sozinha não comunica (doc 16 §5). */}
                        {evento.sensivel ? '⚑ ' : ''}
                        {evento.acaoLabel}
                      </span>
                      <span className="block font-mono text-xs text-app-muted">{evento.acao}</span>
                      {detalhes(evento.changes).length > 0 ? (
                        <details className="mt-1 text-xs text-app-muted">
                          <summary className="cursor-pointer text-app-muted">Detalhes</summary>
                          <dl className="mt-1 space-y-0.5">
                            {detalhes(evento.changes).map(([chave, valor]) => (
                              <div key={chave} className="flex gap-2">
                                <dt className="text-app-muted">{chave}:</dt>
                                <dd className="break-all text-app-muted">{valor}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ) : null}
                    </td>
                    <td
                      className={`px-4 py-3 ${CORES_DO_RESULTADO[evento.resultado] ?? 'text-app-fg'}`}
                    >
                      {AUDIT_RESULTADO_LABEL[evento.resultado]}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block">{evento.recursoTipo}</span>
                      {evento.recursoId ? (
                        <span className="block font-mono text-xs text-app-muted">
                          {evento.recursoId}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-app-muted">
                      {quando.format(new Date(evento.createdAt))}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-app-muted">
                      {evento.ip ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {dados.totalPages > 1 ? (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginação">
              {paginaAtual > 1 ? (
                <Link
                  href={linkDePagina(paginaAtual - 1)}
                  className="text-app-accent underline-offset-4 hover:underline"
                >
                  ← Mais recentes
                </Link>
              ) : (
                <span />
              )}
              <span className="text-app-muted">
                Página {paginaAtual} de {dados.totalPages}
              </span>
              {paginaAtual < dados.totalPages ? (
                <Link
                  href={linkDePagina(paginaAtual + 1)}
                  className="text-app-accent underline-offset-4 hover:underline"
                >
                  Mais antigos →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}

      <p className="text-xs text-app-muted">
        A trilha é <strong className="font-medium text-app-muted">append-only</strong>: a aplicação
        não tem privilégio para alterar nem apagar linha, e o banco recusa a operação antes mesmo da
        tentativa chegar à tabela. Cada entrada carrega o hash da anterior, de modo que remover uma
        quebra a cadeia de forma detectável. Retenção: cinco anos.
      </p>
    </main>
  );
}
