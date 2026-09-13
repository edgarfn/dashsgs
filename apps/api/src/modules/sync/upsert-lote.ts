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

    const sql = Prisma.sql`
      INSERT INTO ${Prisma.raw(`"${opcoes.tabela}"`)} (${Prisma.raw(listaColunas)})
      VALUES ${valores}
      ON CONFLICT (${Prisma.raw(listaChave)})
      DO UPDATE SET ${Prisma.raw(atribuicoes)}`;

    gravadas += await tx.$executeRaw(sql);
  }

  return gravadas;
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
