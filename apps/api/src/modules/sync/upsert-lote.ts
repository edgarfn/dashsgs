import { Prisma } from '@prisma/client';
import { type PrismaTransaction } from '../../common/prisma/prisma.service';

/**
 * Upsert em lote no espelho do ERP.
 *
 * Por que SQL cru e não `prisma.upsert` em laço: um backfill grava dezenas de milhares de linhas,
 * e uma ida ao banco por linha transformaria minutos em horas. Aqui uma instrução carrega até
 * `TAMANHO_LOTE` linhas, e o `ON CONFLICT` faz a idempotência que o doc 14 §1 exige — rodar duas
 * vezes o mesmo período não duplica nada.
 *
 * Todo valor viaja como **texto com cast explícito** (`$1::numeric`, `$2::date`). Parece
 * preciosismo, mas é o que evita dois defeitos clássicos: dinheiro passando por float e data
 * virando o dia anterior por causa do fuso da sessão do Postgres.
 */

export type TipoColuna = 'uuid' | 'text' | 'int' | 'numeric' | 'date' | 'bool' | 'timestamptz';

export interface Coluna {
  nome: string;
  tipo: TipoColuna;
}

/** Valor já normalizado pelo mapper: string, número, booleano, data ou ausência. */
export type ValorColuna = string | number | boolean | Date | null | undefined;

/** Lotes grandes demais estouram o limite de parâmetros do Postgres (65535 por instrução). */
const TAMANHO_LOTE = 500;

const NOME_VALIDO = /^[a-z][a-z0-9_]*$/;

export interface OpcoesUpsert {
  tabela: string;
  colunas: Coluna[];
  /** Colunas da chave natural — as do `ON CONFLICT`. */
  chave: string[];
  /**
   * Colunas atualizadas no conflito. O padrão é "todas menos a chave": o ERP é a fonte da
   * verdade, então o que ele manda agora vale mais do que o que está gravado.
   */
  atualizar?: string[];
  /**
   * Avisado quando o ERP mandou a mesma chave mais de uma vez na mesma coleção. Opcional porque
   * a maioria dos domínios não tem o que fazer a respeito — mas o dado não pode sumir calado.
   */
  aoDuplicar?: (chaves: string[]) => void;
}

export async function upsertLote(
  tx: PrismaTransaction,
  opcoes: OpcoesUpsert,
  linhas: Array<Record<string, ValorColuna>>,
): Promise<number> {
  if (linhas.length === 0) return 0;

  validarIdentificadores(opcoes);

  const atualizar =
    opcoes.atualizar ??
    opcoes.colunas.map((c) => c.nome).filter((nome) => !opcoes.chave.includes(nome));

  const listaColunas = opcoes.colunas.map((coluna) => `"${coluna.nome}"`).join(', ');
  const listaChave = opcoes.chave.map((nome) => `"${nome}"`).join(', ');
  const atribuicoes = atualizar.map((nome) => `"${nome}" = EXCLUDED."${nome}"`).join(', ');

  const unicas = colapsarPorChave(linhas, opcoes);

  let gravadas = 0;

  for (let inicio = 0; inicio < unicas.length; inicio += TAMANHO_LOTE) {
    const fatia = unicas.slice(inicio, inicio + TAMANHO_LOTE);

    const valores = Prisma.join(
      fatia.map(
        (linha) =>
          Prisma.sql`(${Prisma.join(
            opcoes.colunas.map((coluna) => parametro(linha[coluna.nome], coluna.tipo)),
          )})`,
      ),
    );

    const sql = Prisma.sql`
      INSERT INTO ${Prisma.raw(`"${opcoes.tabela}"`)} (${Prisma.raw(listaColunas)})
      VALUES ${valores}
      ON CONFLICT (${Prisma.raw(listaChave)})
      DO UPDATE SET ${Prisma.raw(atribuicoes)}`;

    gravadas += await tx.$executeRaw(sql);
  }

  return gravadas;
}

/**
 * Colapsa linhas que disputam a mesma chave, mantendo a última.
 *
 * O Postgres recusa um `INSERT ... ON CONFLICT DO UPDATE` em que duas linhas PROPOSTAS têm a
 * mesma chave — "ON CONFLICT DO UPDATE command cannot affect row a second time" — e a API da SG
 * devolve exatamente isso: em `/unidadesmedida` a homologação manda a unidade `U` duas vezes.
 * Sem este passo, uma única duplicata no cadastro do cliente derruba o domínio inteiro, e depois
 * de quatro tentativas o job vai para a DLQ. O mock nunca acusaria: fixture tem id único.
 *
 * Fica a ÚLTIMA porque é o que o `ON CONFLICT DO UPDATE` faria se o Postgres aceitasse — cada
 * linha seguinte sobrescreveria a anterior.
 *
 * Chave com NULL não colapsa: no Postgres dois NULLs não conflitam entre si, então essas linhas
 * entram todas, e juntá-las aqui apagaria dado que o banco teria aceitado.
 */
function colapsarPorChave(
  linhas: Array<Record<string, ValorColuna>>,
  opcoes: OpcoesUpsert,
): Array<Record<string, ValorColuna>> {
  if (opcoes.chave.length === 0) return linhas;

  const tipoPorColuna = new Map(opcoes.colunas.map((coluna) => [coluna.nome, coluna.tipo]));
  const porChave = new Map<string, number>();
  const resultado: Array<Record<string, ValorColuna>> = [];
  const repetidas = new Set<string>();

  for (const linha of linhas) {
    const partes = opcoes.chave.map((nome) =>
      paraTexto(linha[nome], tipoPorColuna.get(nome) ?? 'text'),
    );

    if (partes.some((parte) => parte === null)) {
      resultado.push(linha);
      continue;
    }

    // NUL como separador porque o Postgres não aceita esse byte dentro de `text`: nenhuma chave
    // que chegue a ser gravada pode contê-lo, então ("a", "b|c") nunca colide com ("a|b", "c").
    const chave = partes.join('\u0000');
    const posicao = porChave.get(chave);

    if (posicao === undefined) {
      porChave.set(chave, resultado.length);
      resultado.push(linha);
    } else {
      resultado[posicao] = linha;
      repetidas.add(partes.join(' | '));
    }
  }

  if (repetidas.size > 0) opcoes.aoDuplicar?.([...repetidas]);

  return resultado;
}

/** Insere sem conflito (usado depois de apagar a fatia — estratégia de substituição do dia). */
export async function inserirLote(
  tx: PrismaTransaction,
  opcoes: Omit<OpcoesUpsert, 'chave' | 'atualizar'>,
  linhas: Array<Record<string, ValorColuna>>,
): Promise<number> {
  if (linhas.length === 0) return 0;
  validarIdentificadores({ ...opcoes, chave: [] });

  const listaColunas = opcoes.colunas.map((coluna) => `"${coluna.nome}"`).join(', ');
  let gravadas = 0;

  for (let inicio = 0; inicio < linhas.length; inicio += TAMANHO_LOTE) {
    const fatia = linhas.slice(inicio, inicio + TAMANHO_LOTE);
    const valores = Prisma.join(
      fatia.map(
        (linha) =>
          Prisma.sql`(${Prisma.join(
            opcoes.colunas.map((coluna) => parametro(linha[coluna.nome], coluna.tipo)),
          )})`,
      ),
    );

    gravadas += await tx.$executeRaw(Prisma.sql`
      INSERT INTO ${Prisma.raw(`"${opcoes.tabela}"`)} (${Prisma.raw(listaColunas)})
      VALUES ${valores}`);
  }

  return gravadas;
}

/**
 * Um valor vira parâmetro com cast explícito. O cast é o que garante que `"12,5"` já normalizado
 * para `"12.5"` entre como numeric exato, e que `"2026-09-13"` entre como aquele dia — não como
 * o anterior, dependendo do fuso da sessão.
 */
function parametro(valor: ValorColuna, tipo: TipoColuna): Prisma.Sql {
  const texto = paraTexto(valor, tipo);
  switch (tipo) {
    case 'uuid':
      return Prisma.sql`${texto}::uuid`;
    case 'int':
      return Prisma.sql`${texto}::int`;
    case 'numeric':
      return Prisma.sql`${texto}::numeric`;
    case 'date':
      return Prisma.sql`${texto}::date`;
    case 'bool':
      return Prisma.sql`${texto}::boolean`;
    case 'timestamptz':
      return Prisma.sql`${texto}::timestamptz`;
    default:
      return Prisma.sql`${texto}::text`;
  }
}

function paraTexto(valor: ValorColuna, tipo: TipoColuna): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) {
    return tipo === 'date' ? valor.toISOString().slice(0, 10) : valor.toISOString();
  }
  if (typeof valor === 'boolean') return valor ? 'true' : 'false';
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return null;
    return tipo === 'int' ? String(Math.trunc(valor)) : String(valor);
  }
  const texto = valor.trim();
  return texto === '' ? null : texto;
}

/**
 * Nomes de tabela e coluna entram na instrução como identificadores (não dá para parametrizar).
 * Eles vêm de constantes do nosso código, nunca do usuário — e esta checagem mantém isso verdade
 * mesmo se alguém, um dia, tentar montar um mapeamento dinâmico.
 */
function validarIdentificadores(opcoes: Omit<OpcoesUpsert, 'atualizar'>): void {
  const nomes = [opcoes.tabela, ...opcoes.colunas.map((c) => c.nome), ...opcoes.chave];
  for (const nome of nomes) {
    if (!NOME_VALIDO.test(nome)) {
      throw new Error(`identificador inválido em upsertLote: ${nome}`);
    }
  }
}
