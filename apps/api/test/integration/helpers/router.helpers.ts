import type { INestApplication } from '@nestjs/common';

/**
 * Catálogo de rotas lido do próprio router do Express.
 *
 * A suíte A→B é **gerada** daqui, e não escrita à mão, por um motivo: endpoint novo que ninguém
 * lembrou de testar é exatamente o que vaza dado entre tenants (doc 08 §6.1). Se uma rota aparece
 * no router e não está classificada no teste, o teste falha.
 */
export interface RotaRegistrada {
  method: string;
  path: string;
  /** Nomes dos parâmetros de caminho, ex.: ['membershipId']. */
  params: string[];
}

interface ExpressLayer {
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
  };
}

/**
 * Além dos endpoints, o Nest registra dois artefatos de framework: um coringa por método para
 * responder 404 (`/api/v1/{*path}`) e uma âncora do próprio prefixo. Nenhum dos dois é endpoint
 * do produto — incluí-los faria a suíte cobrar classificação de verbos que nem existem aqui.
 */
const MARCAS_DE_ARTEFATO = ['*', '$'];

/**
 * Verbos que o produto expõe. O Express marca como "aceitos" todos os métodos que conhece
 * (ACL, BIND, CHECKOUT, LINK, LOCK…) nas rotas que o Nest registra internamente — e listar isso
 * encheria a suíte de verbos fantasmas.
 */
const VERBOS_DO_PRODUTO = new Set(['get', 'post', 'put', 'patch', 'delete']);

export function listarRotas(app: INestApplication): RotaRegistrada[] {
  const server = app.getHttpAdapter().getInstance() as {
    router?: { stack: ExpressLayer[] };
    _router?: { stack: ExpressLayer[] };
  };
  // Express 5 expõe `router`; o 4 usava `_router`. Aceitamos os dois para não prender a suíte
  // a um detalhe de versão do framework.
  const stack = server.router?.stack ?? server._router?.stack ?? [];

  const rotas: RotaRegistrada[] = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    const caminhos = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];

    for (const caminho of caminhos) {
      if (MARCAS_DE_ARTEFATO.some((marca) => caminho.includes(marca))) continue;

      for (const [method, ativo] of Object.entries(layer.route.methods)) {
        if (!ativo || !VERBOS_DO_PRODUTO.has(method)) continue;
        rotas.push({
          method: method.toUpperCase(),
          path: caminho,
          params: [...caminho.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1] as string),
        });
      }
    }
  }

  return rotas.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

/** `/api/v1/tenant/users/:membershipId` + {membershipId: 'x'} → `/api/v1/tenant/users/x` */
export function preencherParams(path: string, valores: Record<string, string>): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_full, nome: string) => {
    const valor = valores[nome];
    if (!valor) throw new Error(`sem valor para o parâmetro :${nome} em ${path}`);
    return encodeURIComponent(valor);
  });
}
