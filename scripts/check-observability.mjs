#!/usr/bin/env node
/**
 * Gate de observabilidade (doc 18): nenhuma regra e nenhum painel pode citar métrica que
 * ninguém emite.
 *
 * O motivo existe e já custou caro: um alerta escrito sobre `sg_token_refresh_total{result=
 * "unauthorized"}` — nome plausível, rótulo que o código nunca emite — não falha, não avisa e
 * não dispara. Ele simplesmente fica quieto para sempre. É o pior defeito possível num sistema
 * de alarme, porque o sintoma é exatamente igual a "está tudo bem".
 *
 * O que este script confere:
 *   1. toda métrica citada em regra ou painel existe — no registro da aplicação
 *      (metrics.service.ts), entre as séries gravadas pelas próprias regras, ou na lista de
 *      métricas de terceiros (exporters);
 *   2. todo valor de rótulo fechado casado nas regras existe no VOCABULARIO_METRICAS;
 *   3. todo alerta traz `runbook` e `resumo` — alerta sem procedimento é ruído com hora marcada;
 *   4. os JSON dos painéis são válidos e não repetem `uid`.
 *
 * Uso: pnpm obs:check
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..');
const DIR_REGRAS = join(RAIZ, 'docker/observability/prometheus/regras');
const DIR_PAINEIS = join(RAIZ, 'docker/observability/grafana/paineis');
const FONTE_METRICAS = join(RAIZ, 'apps/api/src/common/metrics/metrics.service.ts');

const problemas = [];
const avisos = [];

function reprovar(onde, mensagem) {
  problemas.push(`${onde}: ${mensagem}`);
}

// --------------------------------------------------------------------------------------------
// 1. O que a aplicação emite, lido da única fonte que não mente: o registro.

function metricasDaAplicacao() {
  const fonte = readFileSync(FONTE_METRICAS, 'utf8');
  const nomes = new Set();

  for (const [, nome] of fonte.matchAll(/^\s*name: '([a-z][a-z0-9_]*)',$/gm)) {
    nomes.add(nome);
    // Histograma e summary publicam séries derivadas; regra que usa `_bucket` está correta e
    // não pode ser reprovada por não achar o nome exato.
    for (const sufixo of ['_bucket', '_sum', '_count']) nomes.add(`${nome}${sufixo}`);
  }

  if (nomes.size === 0) {
    reprovar('metrics.service.ts', 'nenhuma métrica encontrada — o gate ficaria inútil');
  }
  return nomes;
}

function vocabulario() {
  const fonte = readFileSync(FONTE_METRICAS, 'utf8');
  const bloco = /export const VOCABULARIO_METRICAS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(fonte);
  if (!bloco) {
    reprovar('metrics.service.ts', 'VOCABULARIO_METRICAS não encontrado');
    return {};
  }

  const tabela = {};
  // Formato esperado: `metrica: { rotulo: ['a', 'b'] }` — possivelmente em várias linhas.
  const texto = bloco[1].replace(/\/\/[^\n]*/g, '');
  for (const [, metrica, corpo] of texto.matchAll(/([a-z][a-z0-9_]*):\s*\{([\s\S]*?)\}/g)) {
    tabela[metrica] = {};
    for (const [, rotulo, valores] of corpo.matchAll(/([a-z][a-z0-9_]*):\s*\[([\s\S]*?)\]/g)) {
      tabela[metrica][rotulo] = [...valores.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    }
  }
  return tabela;
}

/**
 * Métricas que vêm de fora da aplicação. Prefixo em vez de nome exato de propósito: a lista
 * completa de um exporter muda a cada versão dele, e manter cópia dessa lista aqui seria um
 * segundo lugar para envelhecer.
 */
const PREFIXOS_DE_TERCEIROS = [
  'node_', // node-exporter
  'pg_', // postgres-exporter
  'redis_', // redis-exporter
  'probe_', // blackbox-exporter
  'prometheus_', // o próprio Prometheus
  'dashsgs_', // default metrics do prom-client (prefixadas no registro)
  'backup_', // textfile escrito por scripts/backup/backup.sh
  'restore_test_', // textfile escrito por scripts/backup/restore-test.sh
  'up', // série sintética do scrape
];

// Palavras da linguagem PromQL que o extrator encontraria como se fossem métricas.
const PALAVRAS_PROMQL = new Set([
  'by',
  'on',
  'and',
  'or',
  'unless',
  'without',
  'group_left',
  'group_right',
  'ignoring',
  'offset',
  'bool',
  'le',
  'rate',
  'irate',
  'increase',
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'count_values',
  'stddev',
  'stdvar',
  'topk',
  'bottomk',
  'quantile',
  'histogram_quantile',
  'absent',
  'absent_over_time',
  'time',
  'vector',
  'scalar',
  'clamp_min',
  'clamp_max',
  'predict_linear',
  'delta',
  'idelta',
  'deriv',
  'changes',
  'resets',
  'hour',
  'minute',
  'day',
  'month',
  'year',
  'avg_over_time',
  'sum_over_time',
  'max_over_time',
  'min_over_time',
  'count_over_time',
  'quantile_over_time',
  'last_over_time',
  'label_replace',
  'label_join',
  'round',
  'abs',
  'ceil',
  'floor',
  'exp',
  'ln',
  'log2',
  'log10',
  'sqrt',
  'sgn',
]);

function conhecida(nome, emitidas, gravadas) {
  if (emitidas.has(nome) || gravadas.has(nome)) return true;
  if (nome.includes(':')) return false; // série derivada: tem que estar em alguma regra
  return PREFIXOS_DE_TERCEIROS.some((p) => (p.endsWith('_') ? nome.startsWith(p) : nome === p));
}

/** Nomes de métrica de uma expressão PromQL, incluindo séries gravadas (`a:b:c`). */
function metricasDaExpressao(expr) {
  const semTexto = expr.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  const nomes = new Set();
  for (const [, nome] of semTexto.matchAll(
    /(?<![\w:.])([a-zA-Z_][a-zA-Z0-9_]*(?::[a-zA-Z0-9_]+)*)/g,
  )) {
    if (PALAVRAS_PROMQL.has(nome)) continue;
    // `{tenant="x"}` — nome de rótulo seguido de comparador não é métrica.
    nomes.add(nome);
  }
  return nomes;
}

/** Remove o que é claramente rótulo (`foo=`, `foo=~`, `by (foo)`) antes de checar métricas. */
function semRotulos(expr) {
  return expr
    .replace(/\{[^}]*\}/g, '{}')
    .replace(/\bby\s*\(([^)]*)\)/g, 'by ()')
    .replace(/\bwithout\s*\(([^)]*)\)/g, 'without ()')
    .replace(/\bon\s*\(([^)]*)\)/g, 'on ()')
    .replace(/\bignoring\s*\(([^)]*)\)/g, 'ignoring ()');
}

/** Pares `rotulo="valor"` de uma expressão, por métrica. */
function matchersDaExpressao(expr) {
  const encontrados = [];
  for (const [, metrica, corpo] of expr.matchAll(/([a-z][a-z0-9_]*)\{([^}]*)\}/g)) {
    for (const [, rotulo, operador, valor] of corpo.matchAll(
      /([a-z][a-z0-9_]*)\s*(=~|!~|!=|=)\s*"([^"]*)"/g,
    )) {
      encontrados.push({ metrica, rotulo, operador, valor });
    }
  }
  return encontrados;
}

// --------------------------------------------------------------------------------------------
// 2. Leitura das regras. YAML mínimo, sem dependência: só precisamos de `record`, `alert`,
//    `expr` e das anotações — e um parser de 40 linhas não trava o CI por incompatibilidade
//    de versão de uma biblioteca que usaríamos uma vez.

function lerRegras(caminho) {
  const linhas = readFileSync(caminho, 'utf8').split('\n');
  const regras = [];
  let atual = null;
  let coletandoExpr = false;
  let indentacaoExpr = 0;
  let anotacoes = false;

  const fechar = () => {
    if (atual) regras.push(atual);
    atual = null;
    coletandoExpr = false;
    anotacoes = false;
  };

  for (const bruta of linhas) {
    const linha = bruta.replace(/\r$/, '');
    const semComentario = /^\s*#/.test(linha) ? '' : linha;
    const indentacao = semComentario.search(/\S/);

    if (coletandoExpr) {
      if (semComentario.trim() === '' || indentacao >= indentacaoExpr) {
        atual.expr += ` ${semComentario.trim()}`;
        continue;
      }
      coletandoExpr = false;
    }

    const inicio = /^\s*-\s+(record|alert):\s*(.+?)\s*$/.exec(semComentario);
    if (inicio) {
      fechar();
      atual = { tipo: inicio[1], nome: inicio[2], expr: '', anotacoes: {}, arquivo: caminho };
      continue;
    }
    if (!atual) continue;

    const expr = /^\s*expr:\s*(.*)$/.exec(semComentario);
    if (expr) {
      if (expr[1] === '|' || expr[1] === '>-' || expr[1] === '>') {
        coletandoExpr = true;
        indentacaoExpr = indentacao + 2;
        atual.expr = '';
      } else {
        atual.expr = expr[1];
      }
      continue;
    }

    if (/^\s*annotations:\s*$/.test(semComentario)) {
      anotacoes = true;
      continue;
    }
    if (/^\s*labels:\s*$/.test(semComentario)) {
      anotacoes = false;
      continue;
    }
    if (anotacoes) {
      const anotacao = /^\s*([a-z_]+):\s*(.*)$/.exec(semComentario);
      if (anotacao) atual.anotacoes[anotacao[1]] = anotacao[2];
    }
  }
  fechar();
  return regras;
}

// --------------------------------------------------------------------------------------------

const emitidas = metricasDaAplicacao();
const tabelaVocabulario = vocabulario();

const arquivosDeRegra = readdirSync(DIR_REGRAS).filter((f) => f.endsWith('.yml'));
if (arquivosDeRegra.length === 0) reprovar(DIR_REGRAS, 'nenhum arquivo de regra encontrado');

const regras = arquivosDeRegra.flatMap((f) => lerRegras(join(DIR_REGRAS, f)));
const gravadas = new Set(regras.filter((r) => r.tipo === 'record').map((r) => r.nome));

for (const regra of regras) {
  const onde = `${regra.arquivo.split(/[\\/]/).pop()} → ${regra.nome}`;

  if (!regra.expr.trim()) {
    reprovar(onde, 'sem `expr`');
    continue;
  }

  for (const nome of metricasDaExpressao(semRotulos(regra.expr))) {
    if (!conhecida(nome, emitidas, gravadas)) {
      reprovar(onde, `métrica desconhecida: ${nome}`);
    }
  }

  for (const { metrica, rotulo, operador, valor } of matchersDaExpressao(regra.expr)) {
    const permitidos = tabelaVocabulario[metrica]?.[rotulo];
    if (!permitidos) continue; // rótulo aberto (tenant, route, queue…): nada a conferir

    // Em `=~` e `!~` o valor é uma alternância: cada ramo tem que existir.
    const candidatos = operador === '=~' || operador === '!~' ? valor.split('|') : [valor];
    for (const candidato of candidatos) {
      if (!permitidos.includes(candidato)) {
        reprovar(
          onde,
          `${metrica}{${rotulo}="${candidato}"} não existe no vocabulário ` +
            `(valores emitidos: ${permitidos.join(', ')})`,
        );
      }
    }
  }

  if (regra.tipo === 'alert') {
    if (!regra.anotacoes.resumo) reprovar(onde, 'alerta sem anotação `resumo`');
    if (!regra.anotacoes.runbook) {
      reprovar(onde, 'alerta sem anotação `runbook` — alerta sem procedimento vira ruído');
    }
  }
}

// --------------------------------------------------------------------------------------------
// 3. Painéis do Grafana.

const arquivosDePainel = readdirSync(DIR_PAINEIS).filter((f) => f.endsWith('.json'));
if (arquivosDePainel.length === 0) reprovar(DIR_PAINEIS, 'nenhum painel encontrado');

const uids = new Map();

for (const arquivo of arquivosDePainel) {
  const caminho = join(DIR_PAINEIS, arquivo);
  let painel;
  try {
    painel = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (erro) {
    reprovar(arquivo, `JSON inválido: ${erro.message}`);
    continue;
  }

  if (!painel.uid) reprovar(arquivo, 'painel sem `uid` — o provisionamento precisa dele');
  if (uids.has(painel.uid)) {
    reprovar(arquivo, `uid duplicado com ${uids.get(painel.uid)}: ${painel.uid}`);
  }
  uids.set(painel.uid, arquivo);

  if (!painel.title) reprovar(arquivo, 'painel sem `title`');

  const alvos = [];
  const visitar = (no) => {
    if (Array.isArray(no)) return no.forEach(visitar);
    if (!no || typeof no !== 'object') return;
    if (typeof no.expr === 'string') alvos.push({ expr: no.expr, datasource: no.datasource });
    Object.values(no).forEach(visitar);
  };
  visitar(painel.panels ?? []);

  if (alvos.length === 0) avisos.push(`${arquivo}: nenhuma consulta encontrada`);

  for (const alvo of alvos) {
    // Consulta LogQL (Loki) não se valida com a lista de métricas do Prometheus.
    if (alvo.datasource?.type === 'loki') continue;

    const expr = alvo.expr.replace(/\$\{?[a-zA-Z_][a-zA-Z0-9_]*\}?/g, '""');
    for (const nome of metricasDaExpressao(semRotulos(expr))) {
      if (!conhecida(nome, emitidas, gravadas)) {
        reprovar(arquivo, `métrica desconhecida em painel: ${nome}`);
      }
    }
  }
}

// --------------------------------------------------------------------------------------------

for (const aviso of avisos) console.warn(`aviso  ${aviso}`);

if (problemas.length > 0) {
  console.error(`\n${problemas.length} problema(s) de observabilidade:\n`);
  for (const problema of problemas) console.error(`  ✗ ${problema}`);
  console.error('\nRegra ou painel citando métrica que ninguém emite fica em silêncio para');
  console.error('sempre — e silêncio é indistinguível de "está tudo bem".\n');
  process.exit(1);
}

console.log(
  `observabilidade ok — ${regras.length} regra(s) e ${arquivosDePainel.length} painel(is) ` +
    `conferidos contra ${emitidas.size} série(s) emitidas`,
);
