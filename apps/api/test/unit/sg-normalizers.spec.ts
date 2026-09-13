import {
  normalizarPagina,
  sgBooleano,
  sgData,
  sgHora,
  sgId,
  sgNumero,
  sgTexto,
} from '../../src/integration/sg/normalizers';
import {
  FIXTURE_ARRAY_PURO,
  FIXTURE_FILIAIS,
  FIXTURE_MARCAS,
  FIXTURE_PRODUTOS,
} from '../../src/integration/sg/mock/fixtures';
import { filialSchema, produtoSchema, vendaCupomSchema } from '../../src/integration/sg/types';

/**
 * Normalização da camada anticorrupção (doc 12 §4). Cada caso aqui é uma esquisitice
 * **documentada** da API SG — se a normalização falhar, ela vaza para o banco e para as telas.
 */
describe('normalizadores', () => {
  it('apara padding de espaços em ids (doc 03, obs. 3)', () => {
    expect(sgId.parse('5 ')).toBe('5');
    expect(sgId.parse('  TES   ')).toBe('TES');
    expect(sgId.parse(42)).toBe('42');
    expect(() => sgId.parse('   ')).toThrow();
  });

  it('trata data vazia e zerada como ausente (doc 03, obs. 4)', () => {
    expect(sgData.parse('2026-09-11')).toBe('2026-09-11');
    expect(sgData.parse('2026-09-11 10:00:00')).toBe('2026-09-11');
    expect(sgData.parse('')).toBeNull();
    expect(sgData.parse('0000-00-00')).toBeNull();
    expect(sgData.parse(null)).toBeNull();
    expect(sgData.parse(undefined)).toBeNull();
  });

  it('normaliza hora sem timezone', () => {
    expect(sgHora.parse('9:35')).toBe('09:35');
    expect(sgHora.parse('23:05')).toBe('23:05');
    expect(sgHora.parse('')).toBeNull();
  });

  it('entende pseudo-booleano em char (doc 02 §4.5)', () => {
    expect(sgBooleano.parse('S')).toBe(true);
    expect(sgBooleano.parse('s')).toBe(true);
    expect(sgBooleano.parse(true)).toBe(true);
    expect(sgBooleano.parse('1')).toBe(true);
    expect(sgBooleano.parse(' ')).toBe(false);
    expect(sgBooleano.parse('N')).toBe(false);
    expect(sgBooleano.parse('')).toBe(false);
    expect(sgBooleano.parse(null)).toBe(false);
  });

  it('aceita número como int, float e string com vírgula', () => {
    expect(sgNumero.parse(18.4)).toBe(18.4);
    expect(sgNumero.parse('7,90')).toBe(7.9);
    expect(sgNumero.parse('1.234,50')).toBe(1234.5);
    expect(sgNumero.parse('')).toBeNull();
    expect(sgNumero.parse('abc')).toBeNull();
  });

  it('texto vazio vira null e respeita o limite', () => {
    expect(sgTexto(10).parse('  loja  ')).toBe('loja');
    expect(sgTexto(10).parse('')).toBeNull();
    expect(sgTexto(4).parse('abcdefgh')).toBe('abcd');
  });
});

describe('envelope de paginação (doc 02 §3)', () => {
  it('entende o envelope `paginacao`', () => {
    const pagina = normalizarPagina(FIXTURE_FILIAIS, 'filiais');
    expect(pagina.itens).toHaveLength(3);
    expect(pagina.quantidadePaginas).toBe(1);
    expect(pagina.quantidadeItens).toBe(3);
  });

  it('entende o envelope `ordenacao`, usado por outros módulos', () => {
    const pagina = normalizarPagina(FIXTURE_MARCAS, 'marcas');
    expect(pagina.itens).toHaveLength(2);
    expect(pagina.pagina).toBe(1);
  });

  it('entende array puro, sem envelope nenhum', () => {
    const pagina = normalizarPagina(FIXTURE_ARRAY_PURO);
    expect(pagina.itens).toHaveLength(2);
    expect(pagina.quantidadePaginas).toBe(1);
  });

  it('acha a lista mesmo sem saber o nome da chave', () => {
    const pagina = normalizarPagina({ paginacao: { pagina: 1 }, qualquerCoisa: [{ id: 1 }] });
    expect(pagina.itens).toHaveLength(1);
  });

  it('calcula o total de páginas quando o envelope não informa', () => {
    const pagina = normalizarPagina({
      paginacao: { pagina: 1, itensPorPagina: 2, quantidadeItens: 5 },
      itens: [{ id: 1 }, { id: 2 }],
    });
    expect(pagina.quantidadePaginas).toBe(3);
  });

  it('sobrevive a corpo nulo ou inesperado', () => {
    expect(normalizarPagina(null).itens).toEqual([]);
    expect(normalizarPagina('texto').itens).toEqual([]);
  });
});

describe('schemas de recurso', () => {
  it('limpa uma filial com padding, uf minúscula e flag em char', () => {
    const filial = filialSchema.parse(FIXTURE_FILIAIS.filiais[1]);
    expect(filial).toMatchObject({ erpId: 2, uf: 'SP', ativa: true });
    expect(filial.cnpj).toBe('12345678000271');
  });

  it('marca filial inativa quando a flag vem como "S"', () => {
    const filial = filialSchema.parse(FIXTURE_FILIAIS.filiais[2]);
    expect(filial.ativa).toBe(false);
    expect(filial.nomeFantasia).toBeNull();
  });

  it('normaliza produto com número em string e datas vazias', () => {
    const produto = produtoSchema.parse(FIXTURE_PRODUTOS.produtos[1]);
    expect(produto.erpId).toBe(1002);
    expect(produto.custos.real).toBe(7.9);
    expect(produto.dataAlteracaoPreco).toBeNull();
    expect(produto.ativo).toBe(true);
  });

  it('recusa produto sem id — vai para quarentena, não para o banco', () => {
    expect(produtoSchema.safeParse(FIXTURE_PRODUTOS.produtos[2]).success).toBe(false);
  });

  it('marca venda identificada só quando há cliente', () => {
    const anonima = vendaCupomSchema.parse({ idFilial: 1, caixa: 1, cupom: 1, idCliente: 0 });
    const identificada = vendaCupomSchema.parse({
      idFilial: 1,
      caixa: 1,
      cupom: 2,
      idCliente: 4711,
    });

    expect(anonima.identificada).toBe(false);
    expect(identificada.identificada).toBe(true);
    expect(identificada.clienteErpId).toBe(4711);
  });

  it('apara o idOferta com espaço no item de venda (doc 03, obs. 3)', () => {
    const venda = vendaCupomSchema.parse({
      idFilial: 1,
      caixa: 1,
      cupom: 3,
      itens: [{ ordem: 1, idProduto: 10, idOferta: '5 ', quantidade: 1, precoVenda: 2 }],
    });
    expect(venda.itens[0]?.ofertaErpId).toBe('5');
  });
});
