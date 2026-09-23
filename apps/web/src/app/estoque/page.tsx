import Link from 'next/link';
import { Alert } from '@/components/ui';
import { CardKpi, EstadoVazio, SeloDeFrescor, formatar } from '@/components/dashboard';
import { Cabecalho, FiltrosGlobais } from '@/components/navegacao';
import { apiRequest } from '@/lib/server/api-client';
import { requireMe } from '@/lib/server/session';

export const metadata = { title: 'Estoque — DashSGS' };
export const dynamic = 'force-dynamic';

interface EstoqueView {
  situacao: 'ruptura' | 'negativo' | 'excesso';
  contagens: { ruptura: number; negativo: number; excesso: number; curvaAEmRuptura: number };
  produtos: Array<{
    erpId: number;
    descricao: string;
    filialErpId: number;
    filialNome: string;
    curvaAbc: string | null;
    estoqueAtual: number;
    estoqueMinimo: number;
    estoqueMaximo: number | null;
    vendaMediaDiaria: number;
    coberturaDias: number | null;
    precoVenda: number | null;
    departamento: string | null;
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

const TITULOS = {
  ruptura: 'Ruptura (abaixo do estoque mínimo)',
  negativo: 'Estoque negativo',
  excesso: 'Excesso (acima do máximo)',
} as const;

const VAZIOS = {
  ruptura: {
    titulo: 'Nenhum produto em ruptura 🎉',
    descricao: 'Nenhum item ativo está abaixo do estoque mínimo no recorte selecionado.',
  },
  negativo: {
    titulo: 'Nenhum estoque negativo',
    descricao:
      'Estoque negativo costuma indicar venda sem entrada lançada. Nada apareceu neste recorte.',
  },
  excesso: {
    titulo: 'Nenhum produto acima do máximo',
    descricao: 'Nenhum item ativo passou do estoque máximo cadastrado no recorte selecionado.',
  },
} as const;

function paraFiltro(filiais: FilialView[] | null) {
  return (filiais ?? [])
    .filter((filial) => filial.ativa)
    .map((filial) => ({ erpId: filial.erpId, nome: filial.nomeFantasia ?? filial.razaoSocial }));
}

/**
 * Estoque — ruptura, negativo e excesso (doc 15 §4 / E7-04 parcial).
 *
 * A lista chega ordenada por curva ABC e cobertura: item A prestes a faltar aparece primeiro,
 * porque é a venda que se perde hoje. Vencimentos e perdas entram quando os domínios de sync
 * correspondentes existirem (E5-10).
 */
export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireMe();
  const params = await searchParams;

  if (!me.permissions.includes('dashboard.view')) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-12">
        <Cabecalho me={me} ativo="estoque" />
        <Alert kind="info">Sua conta não tem acesso aos painéis desta rede.</Alert>
      </main>
    );
  }

  const texto = (chave: string) => (typeof params[chave] === 'string' ? params[chave] : undefined);
  const situacao = (texto('situacao') ?? 'ruptura') as EstoqueView['situacao'];
  const curva = texto('curva');
  const filiaisParam = texto('filiais');
  const pagina = Number(texto('pagina') ?? '1');

  const consulta = new URLSearchParams({ situacao, pagina: String(pagina) });
  if (curva) consulta.set('curva', curva);
  if (filiaisParam) consulta.set('filiais', filiaisParam);

  const [resposta, filiais] = await Promise.all([
    apiRequest<EstoqueView>('GET', `/dashboard/estoque?${consulta.toString()}`),
    apiRequest<FilialView[]>('GET', '/dim/filiais'),
  ]);

  const estoque = resposta.data;
  const linkSituacao = (alvo: EstoqueView['situacao']) => {
    const url = new URLSearchParams(consulta);
    url.set('situacao', alvo);
    url.delete('pagina');
    return `/estoque?${url.toString()}`;
  };
  const paginaUrl = (numero: number) => {
    const url = new URLSearchParams(consulta);
    url.set('pagina', String(numero));
    return `/estoque?${url.toString()}`;
  };

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-12">
      <Cabecalho me={me} ativo="estoque" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-app-fg">{TITULOS[situacao]}</h2>
        {estoque ? <SeloDeFrescor frescor={estoque.frescor} /> : null}
      </div>

      {estoque ? (
        <div className="grid gap-4 sm:grid-cols-4">
          <Link href={linkSituacao('ruptura')} className="block">
            <CardKpi
              titulo="Em ruptura"
              valor={formatar.inteiro(estoque.contagens.ruptura)}
              detalhe="abaixo do estoque mínimo"
            />
          </Link>
          <CardKpi
            titulo="Curva A em ruptura"
            valor={formatar.inteiro(estoque.contagens.curvaAEmRuptura)}
            detalhe="prioridade de reposição"
          />
          <Link href={linkSituacao('negativo')} className="block">
            <CardKpi
              titulo="Estoque negativo"
              valor={formatar.inteiro(estoque.contagens.negativo)}
              detalhe="venda sem entrada lançada"
            />
          </Link>
          <Link href={linkSituacao('excesso')} className="block">
            <CardKpi
              titulo="Acima do máximo"
              valor={formatar.inteiro(estoque.contagens.excesso)}
              detalhe="capital parado"
            />
          </Link>
        </div>
      ) : null}

      <FiltrosGlobais filiais={paraFiltro(filiais.data)} selecionadas={filiaisParam}>
        <input type="hidden" name="situacao" value={situacao} />
        <div className="space-y-1.5">
          <label htmlFor="filtro-curva" className="block text-xs text-app-muted">
            Curva ABC
          </label>
          <select
            id="filtro-curva"
            name="curva"
            defaultValue={curva ?? ''}
            className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-fg outline-none focus:border-app-accent/60"
          >
            <option value="" className="bg-app-bg">
              Todas
            </option>
            <option value="A" className="bg-app-bg">
              Somente A
            </option>
            <option value="B" className="bg-app-bg">
              Somente B
            </option>
            <option value="C" className="bg-app-bg">
              Somente C
            </option>
          </select>
        </div>
      </FiltrosGlobais>

      {!estoque ? (
        <Alert kind="error">Não foi possível carregar a situação do estoque.</Alert>
      ) : estoque.produtos.length === 0 ? (
        <EstadoVazio
          titulo={VAZIOS[situacao].titulo}
          descricao={VAZIOS[situacao].descricao}
          acao={
            estoque.frescor.atualizadoEm === null &&
            me.permissions.includes('erp_connection.manage')
              ? { href: '/admin/sincronizacao', rotulo: 'Ver sincronização' }
              : undefined
          }
        />
      ) : (
        <section className="space-y-3 rounded-xl border border-app-border bg-app-surface p-6">
          <h3 className="text-sm font-medium uppercase tracking-wider text-app-muted">
            {formatar.inteiro(estoque.paginacao.total)} produtos
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-app-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Curva</th>
                  <th className="py-2 pr-4 font-medium">Produto</th>
                  <th className="py-2 pr-4 font-medium">Filial</th>
                  <th className="py-2 pr-4 text-right font-medium">Estoque</th>
                  <th className="py-2 pr-4 text-right font-medium">Mínimo</th>
                  <th className="py-2 pr-4 text-right font-medium">Cobertura</th>
                  <th className="py-2 pr-4 text-right font-medium">Preço</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border text-app-fg">
                {estoque.produtos.map((produto) => (
                  <tr key={`${produto.filialErpId}-${produto.erpId}`}>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          produto.curvaAbc === 'A'
                            ? 'bg-app-danger/10 text-app-danger'
                            : 'bg-app-surface text-app-muted'
                        }`}
                      >
                        {produto.curvaAbc ?? '—'}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-app-fg">{produto.descricao}</span>
                      <span className="block text-xs text-app-muted">
                        #{produto.erpId}
                        {produto.departamento ? ` · ${produto.departamento}` : ''}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{produto.filialNome}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatar.decimal(produto.estoqueAtual)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatar.decimal(produto.estoqueMinimo)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {produto.coberturaDias === null
                        ? 'sem venda'
                        : `${formatar.decimal(produto.coberturaDias)} dias`}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {produto.precoVenda === null ? '—' : formatar.moeda(produto.precoVenda)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {estoque.paginacao.paginas > 1 ? (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginação">
              {estoque.paginacao.pagina > 1 ? (
                <Link
                  href={paginaUrl(estoque.paginacao.pagina - 1)}
                  className="text-app-accent underline-offset-4 hover:underline"
                >
                  ← Página anterior
                </Link>
              ) : (
                <span />
              )}
              <span className="text-app-muted">
                Página {estoque.paginacao.pagina} de {estoque.paginacao.paginas}
              </span>
              {estoque.paginacao.pagina < estoque.paginacao.paginas ? (
                <Link
                  href={paginaUrl(estoque.paginacao.pagina + 1)}
                  className="text-app-accent underline-offset-4 hover:underline"
                >
                  Próxima página →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}

          <p className="text-xs text-app-muted">
            Cobertura = estoque atual ÷ venda média diária do cadastro. Produtos sem venda média
            aparecem como “sem venda”.
          </p>
        </section>
      )}
    </main>
  );
}
