import { type Prisma } from '@prisma/client';
import { type PrismaTransaction } from '../../src/common/prisma/prisma.service';
import { type Coluna, inserirLote, upsertLote } from '../../src/modules/sync/upsert-lote';

/**
 * Construção da instrução de upsert em lote.
 *
 * O teste olha a instrução gerada, não o banco: o que precisa ser garantido aqui é que dinheiro
 * vai como `numeric` (nunca float), data vai como `date` (sem fuso no meio), identificador
 * suspeito nunca chega a virar SQL e o lote é quebrado antes do limite de parâmetros do Postgres.
 */

interface Capturado {
  sql: string;
  valores: unknown[];
}

function transacaoFalsa(): { tx: PrismaTransaction; capturas: Capturado[] } {
  const capturas: Capturado[] = [];
  const tx = {
    $executeRaw: (consulta: Prisma.Sql) => {
      capturas.push({ sql: consulta.sql, valores: consulta.values });
      return Promise.resolve(1);
    },
  } as unknown as PrismaTransaction;

  return { tx, capturas };
}

const COLUNAS: Coluna[] = [
  { nome: 'tenant_id', tipo: 'uuid' },
  { nome: 'erp_id', tipo: 'int' },
  { nome: 'descricao', tipo: 'text' },
  { nome: 'valor', tipo: 'numeric' },
  { nome: 'data', tipo: 'date' },
  { nome: 'ativo', tipo: 'bool' },
];

const TENANT = '11111111-1111-4111-8111-111111111111';

describe('upsertLote', () => {
  it('monta INSERT ... ON CONFLICT DO UPDATE com a chave natural', async () => {
    const { tx, capturas } = transacaoFalsa();

    await upsertLote(
      tx,
      { tabela: 'erp_marcas', colunas: COLUNAS, chave: ['tenant_id', 'erp_id'] },
      [
        {
          tenant_id: TENANT,
          erp_id: 7,
          descricao: 'MARCA',
          valor: 10.5,
          data: '2026-09-13',
          ativo: true,
        },
      ],
    );

    const [captura] = capturas;
    expect(captura?.sql).toContain('INSERT INTO "erp_marcas"');
    expect(captura?.sql).toContain('ON CONFLICT ("tenant_id", "erp_id")');
    expect(captura?.sql).toContain('"descricao" = EXCLUDED."descricao"');
    // A chave nunca entra no SET: atualizar a própria chave seria mover a linha.
    expect(captura?.sql).not.toContain('"erp_id" = EXCLUDED."erp_id"');
  });

  it('manda todo valor como texto, com cast explícito na instrução', async () => {
    const { tx, capturas } = transacaoFalsa();

    await upsertLote(
      tx,
      { tabela: 'erp_marcas', colunas: COLUNAS, chave: ['tenant_id', 'erp_id'] },
      [
        {
          tenant_id: TENANT,
          erp_id: 7,
          descricao: 'MARCA',
          valor: 1234.5678,
          data: new Date('2026-09-13T23:30:00Z'),
          ativo: false,
        },
      ],
    );

    const [captura] = capturas;
    expect(captura?.sql).toContain('::numeric');
    expect(captura?.sql).toContain('::date');
    expect(captura?.sql).toContain('::uuid');

    // Dinheiro viaja com a representação decimal exata, não como float do driver.
    expect(captura?.valores).toContain('1234.5678');
    expect(captura?.valores).toContain('false');
    // Data recortada no dia: 23:30Z não pode virar o dia seguinte por causa de fuso de sessão.
    expect(captura?.valores).toContain('2026-09-13');
  });

  it('trata ausência, vazio e não-número como NULL', async () => {
    const { tx, capturas } = transacaoFalsa();

    await upsertLote(
      tx,
      { tabela: 'erp_marcas', colunas: COLUNAS, chave: ['tenant_id', 'erp_id'] },
      [{ tenant_id: TENANT, erp_id: 7, descricao: '   ', valor: Number.NaN, data: null }],
    );

    const valores = capturas[0]?.valores ?? [];
    // descricao ("   "), valor (NaN), data (null) e ativo (ausente) viram NULL.
    expect(valores.filter((valor) => valor === null)).toHaveLength(4);
  });

  it('quebra em lotes para não estourar o limite de parâmetros do Postgres', async () => {
    const { tx, capturas } = transacaoFalsa();

    const linhas = Array.from({ length: 1_200 }, (_, indice) => ({
      tenant_id: TENANT,
      erp_id: indice,
      descricao: `ITEM ${indice}`,
      valor: indice,
      data: '2026-09-13',
      ativo: true,
    }));

    await upsertLote(
      tx,
      { tabela: 'erp_marcas', colunas: COLUNAS, chave: ['tenant_id', 'erp_id'] },
      linhas,
    );

    expect(capturas).toHaveLength(3);
    for (const captura of capturas) {
      expect(captura.valores.length).toBeLessThanOrEqual(500 * COLUNAS.length);
    }
  });

  it('não faz ida ao banco quando não há linha', async () => {
    const { tx, capturas } = transacaoFalsa();

    const gravadas = await upsertLote(
      tx,
      { tabela: 'erp_marcas', colunas: COLUNAS, chave: ['tenant_id'] },
      [],
    );

    expect(gravadas).toBe(0);
    expect(capturas).toHaveLength(0);
  });

  it('recusa identificador fora do padrão antes de montar SQL', async () => {
    const { tx } = transacaoFalsa();

    await expect(
      upsertLote(
        tx,
        {
          tabela: 'erp_marcas; DROP TABLE app_users',
          colunas: COLUNAS,
          chave: ['tenant_id'],
        },
        [{ tenant_id: TENANT }],
      ),
    ).rejects.toThrow('identificador inválido');

    await expect(
      upsertLote(
        tx,
        {
          tabela: 'erp_marcas',
          colunas: [{ nome: 'descricao") = (SELECT', tipo: 'text' }],
          chave: ['tenant_id'],
        },
        [{ tenant_id: TENANT }],
      ),
    ).rejects.toThrow('identificador inválido');
  });

  /**
   * Chave repetida na MESMA coleção (doc 33).
   *
   * Não é hipótese: a homologação da SG devolve a unidade de medida `U` duas vezes em
   * `/unidadesmedida`. O Postgres recusa o INSERT inteiro nesse caso ("ON CONFLICT DO UPDATE
   * command cannot affect row a second time"), então uma duplicata no cadastro do cliente
   * derrubava o domínio todo. As fixtures do mock têm id único e nunca acusariam.
   */
  describe('chave repetida pelo ERP', () => {
    it('colapsa mantendo a última e avisa quem chamou', async () => {
      const { tx, capturas } = transacaoFalsa();
      const avisos: string[][] = [];

      const gravadas = await upsertLote(
        tx,
        {
          tabela: 'erp_unidades_medida',
          colunas: [
            { nome: 'tenant_id', tipo: 'uuid' },
            { nome: 'erp_id', tipo: 'text' },
            { nome: 'descricao', tipo: 'text' },
          ],
          chave: ['tenant_id', 'erp_id'],
          aoDuplicar: (chaves) => avisos.push(chaves),
        },
        [
          { tenant_id: TENANT, erp_id: 'U', descricao: 'UNIDADE' },
          { tenant_id: TENANT, erp_id: 'KG', descricao: 'QUILO' },
          { tenant_id: TENANT, erp_id: 'U', descricao: 'UNIDADE (2)' },
        ],
      );

      // Uma instrução só, com duas linhas: 3 colunas × 2 linhas = 6 parâmetros.
      expect(capturas).toHaveLength(1);
      expect(capturas[0]?.valores).toHaveLength(6);
      // Vence a última: é o que o ON CONFLICT DO UPDATE faria se o Postgres aceitasse.
      expect(capturas[0]?.valores).toContain('UNIDADE (2)');
      expect(capturas[0]?.valores).not.toContain('UNIDADE');
      expect(avisos).toEqual([[`${TENANT} | U`]]);
      expect(gravadas).toBe(1);
    });

    it('preserva a ordem das linhas que não duplicam', async () => {
      const { tx, capturas } = transacaoFalsa();

      await upsertLote(
        tx,
        {
          tabela: 'erp_marcas',
          colunas: [
            { nome: 'tenant_id', tipo: 'uuid' },
            { nome: 'erp_id', tipo: 'text' },
          ],
          chave: ['tenant_id', 'erp_id'],
        },
        [
          { tenant_id: TENANT, erp_id: 'A' },
          { tenant_id: TENANT, erp_id: 'B' },
          { tenant_id: TENANT, erp_id: 'A' },
          { tenant_id: TENANT, erp_id: 'C' },
        ],
      );

      // A duplicata substitui a primeira NO LUGAR dela: A, B, C — e não B, C, A.
      expect(capturas[0]?.valores).toEqual([TENANT, 'A', TENANT, 'B', TENANT, 'C']);
    });

    /**
     * No Postgres dois NULLs não conflitam entre si, então essas linhas entrariam as duas.
     * Colapsá-las aqui apagaria dado que o banco teria aceitado — seria o upsert inventando
     * uma restrição que a tabela não tem.
     */
    it('não colapsa linhas cuja chave tem NULL', async () => {
      const { tx, capturas } = transacaoFalsa();
      const avisos: string[][] = [];

      await upsertLote(
        tx,
        {
          tabela: 'erp_marcas',
          colunas: [
            { nome: 'tenant_id', tipo: 'uuid' },
            { nome: 'erp_id', tipo: 'text' },
          ],
          chave: ['tenant_id', 'erp_id'],
          aoDuplicar: (chaves) => avisos.push(chaves),
        },
        [
          { tenant_id: TENANT, erp_id: null },
          { tenant_id: TENANT, erp_id: null },
        ],
      );

      expect(capturas[0]?.valores).toHaveLength(4);
      expect(avisos).toEqual([]);
    });

    it('não confunde chaves compostas que concatenam igual', async () => {
      const { tx, capturas } = transacaoFalsa();

      await upsertLote(
        tx,
        {
          tabela: 'erp_marcas',
          colunas: [
            { nome: 'erp_id', tipo: 'text' },
            { nome: 'descricao', tipo: 'text' },
          ],
          chave: ['erp_id', 'descricao'],
        },
        [
          { erp_id: 'a', descricao: 'bc' },
          { erp_id: 'ab', descricao: 'c' },
        ],
      );

      // Um separador ingênuo (string vazia) leria as duas como "abc" e perderia uma linha.
      expect(capturas[0]?.valores).toHaveLength(4);
    });
  });
});

describe('inserirLote', () => {
  it('insere sem cláusula de conflito (usado depois de apagar a fatia)', async () => {
    const { tx, capturas } = transacaoFalsa();

    await inserirLote(tx, { tabela: 'erp_vendas_cupons', colunas: COLUNAS }, [
      { tenant_id: TENANT, erp_id: 1, descricao: 'X', valor: 1, data: '2026-09-13', ativo: true },
    ]);

    expect(capturas[0]?.sql).toContain('INSERT INTO "erp_vendas_cupons"');
    expect(capturas[0]?.sql).not.toContain('ON CONFLICT');
  });
});
