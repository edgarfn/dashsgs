/**
 * Fixtures da API SG (doc 12 §7) — cópias fiéis do **formato** dos exemplos oficiais da coleção
 * Postman, com dados sintéticos.
 *
 * Elas existem para duas coisas: alimentar o modo `SG_MOCK` (desenvolvimento e CI sem ERP) e
 * servir de corpo de prova para os normalizadores. Por isso carregam de propósito todas as
 * esquisitices documentadas — se o mock fosse "limpo", ele testaria um mundo que não existe:
 *
 *  - id com padding de espaços (`"5 "`) — doc 03, observação 3;
 *  - data vazia como `""` em vez de null — doc 03, observação 4;
 *  - pseudo-booleano em char (`"S"`, `" "`) convivendo com boolean JSON — doc 02 §4.5;
 *  - envelope `paginacao` em um recurso, `ordenacao` em outro e array puro num terceiro — §4.1;
 *  - `idGTIN: false` (tipo instável) — doc 03, observação 6.
 */

export const FIXTURE_AUTORIZACAO = {
  token:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c3VhcmlvIjoiaG9tb2xvZ2FjYW8iLCJyb3V0ZXMiOltdfQ.assinatura-sintetica-de-teste',
  routes: [
    'GET /filiais',
    'GET /produtos',
    'GET /vendas',
    'GET /vendas/hoje',
    'GET /vendas/finalizadoras',
    'GET /finalizadoras/hoje',
    'GET /filiais/vendas',
    'GET /marcas',
    'GET /departamentos/nivel1',
    'GET /status',
  ],
  expire_time: '2026-09-13 10:30:00',
};

export const FIXTURE_STATUS = {
  versao: '2026.03',
  revisao: '1187',
  cnpj: '12.345.678/0001-90',
  razaoSocial: 'Rede Homologacao LTDA',
};

/** Envelope `paginacao` + `inativa` como pseudo-booleano. */
export const FIXTURE_FILIAIS = {
  paginacao: { pagina: 1, itensPorPagina: 50, quantidadePaginas: 1, quantidadeItens: 3 },
  filiais: [
    {
      id: 1,
      razaoSocial: 'Rede Homologacao LTDA  ',
      nomeFantasia: 'Loja Centro',
      cnpj: '12.345.678/0001-90',
      idMunicipio: 3550308,
      uf: 'sp',
      inativa: ' ',
    },
    {
      id: '2 ',
      razaoSocial: 'Rede Homologacao LTDA - Filial 2',
      nomeFantasia: 'Loja Norte',
      cnpj: '12345678000271',
      idMunicipio: 3550308,
      uf: 'SP',
      inativa: false,
    },
    {
      id: 3,
      razaoSocial: 'Rede Homologacao LTDA - Filial 3',
      nomeFantasia: '',
      cnpj: '',
      idMunicipio: null,
      uf: 'MG',
      inativa: 'S',
    },
  ],
};

/** Envelope `ordenacao` (em vez de `paginacao`) — inconsistência documentada. */
export const FIXTURE_MARCAS = {
  ordenacao: {
    pagina: 1,
    itensPorPagina: 500,
    quantidadePaginas: 1,
    quantidadeItens: 2,
    ordenacao: { por: 'descricao', direcao: 'asc' },
  },
  marcas: [
    { id: '10', descricao: 'MARCA PROPRIA  ' },
    { id: 11, descricao: 'NACIONAL' },
  ],
};

export const FIXTURE_DEPARTAMENTOS_N1 = {
  paginacao: { pagina: 1, itensPorPagina: 500, quantidadePaginas: 1, quantidadeItens: 2 },
  departamentos: [
    { id: 1, descricao: 'MERCEARIA', departamentalizacaoNivel2: 10 },
    { id: 2, descricao: 'HORTIFRUTI', departamentalizacaoNivel2: 20 },
  ],
};

export const FIXTURE_PRODUTOS = {
  paginacao: { pagina: 1, itensPorPagina: 500, quantidadePaginas: 1, quantidadeItens: 3 },
  produtos: [
    {
      id: 1001,
      idFilial: 1,
      descricao: 'ARROZ TIPO 1 5KG',
      departamentalizacaoNivel1: 1,
      marca: 10,
      classe: 3,
      agrupamento: 7,
      unidadeDeMedida: 'UN',
      inativo: ' ',
      balanca: ' ',
      curvaABC: 'A',
      custoReal: 18.4,
      custoFiscal: 17.9,
      custoComEncargos: 19.1,
      custoMedio: 18.2,
      precoCusto: 18.4,
      precoVenda1: 24.9,
      precoVenda2: 0,
      estoqueAtual: 120,
      estoqueMinimo: 40,
      estoqueMaximo: 400,
      estoqueTrocas: 0,
      vendaMediaDiaria: 12.5,
      dataCadastro: '2024-02-10',
      dataAlteracaoPreco: '2026-09-01',
      dataAlteracaoCusto: '',
      dataAlteracaoCadastro: '0000-00-00',
    },
    {
      id: '1002 ',
      idFilial: 1,
      descricao: 'FEIJAO CARIOCA 1KG',
      departamentalizacaoNivel1: 1,
      marca: 11,
      unidadeDeMedida: 'UN',
      inativo: ' ',
      balanca: 'N',
      curvaABC: 'B',
      custoReal: '7,90',
      precoVenda1: 10.49,
      estoqueAtual: -3,
      estoqueMinimo: 20,
      vendaMediaDiaria: 8,
      dataCadastro: '2023-11-05',
      dataAlteracaoPreco: '',
      dataAlteracaoCusto: '',
      dataAlteracaoCadastro: '',
    },
    {
      // Item propositalmente fora do contrato: sem `id`. Precisa cair em quarentena sem
      // derrubar a página (doc 12 §4.7).
      idFilial: 1,
      descricao: 'PRODUTO SEM ID',
      precoVenda1: 1.99,
    },
  ],
};

export const FIXTURE_VENDAS_DIA = {
  paginacao: { pagina: 1, itensPorPagina: 200, quantidadePaginas: 1, quantidadeItens: 2 },
  vendas: [
    {
      idFilial: 1,
      data: '2026-09-11',
      caixa: 1,
      cupom: 100234,
      serieNFC: '001  ',
      horario: '9:35',
      idCliente: 0,
      idVendedor: 5,
      cancelada: ' ',
      valorTotal: 87.4,
      itens: [
        {
          ordem: 1,
          idProduto: 1001,
          idGTIN: '7891234567890',
          quantidade: 2,
          precoVenda: 24.9,
          desconto: 0,
          acrescimo: 0,
          cancelado: ' ',
          idOferta: '5 ',
          baseICMS: 49.8,
          aliquotaICMS: 18,
          valorICMS: 8.96,
          basePIS: 49.8,
          baseCOFINS: 49.8,
          tipoTributacao: 'T',
          modeloDocumento: '65',
        },
        {
          ordem: 2,
          idProduto: 1002,
          idGTIN: '7891234567891',
          quantidade: 3.5,
          precoVenda: 10.49,
          desconto: 0.5,
          acrescimo: 0,
          cancelado: ' ',
          idOferta: '',
          tipoTributacao: 'T',
          modeloDocumento: '65',
        },
      ],
    },
    {
      idFilial: 1,
      data: '2026-09-11',
      caixa: 2,
      cupom: 100235,
      serieNFC: '001',
      horario: '10:02',
      idCliente: 4711,
      idVendedor: 0,
      cancelada: 'S',
      valorTotal: 15.9,
      itens: [],
    },
  ],
};

/** Tempo real: mesmo formato, **sem** `idVendedor` (doc 02 §4.7). */
export const FIXTURE_VENDAS_HOJE = {
  paginacao: { pagina: 1, itensPorPagina: 200, quantidadePaginas: 1, quantidadeItens: 1 },
  vendas: [
    {
      idFilial: 1,
      data: '2026-09-12',
      caixa: 1,
      cupom: 100301,
      serieNFC: '001',
      horario: '08:12',
      idCliente: 0,
      cancelada: ' ',
      valorTotal: 42.3,
      itens: [
        {
          ordem: 1,
          idProduto: 1001,
          idGTIN: '7891234567890',
          quantidade: 1,
          precoVenda: 24.9,
          cancelado: ' ',
        },
      ],
    },
  ],
};

export const FIXTURE_FINALIZADORAS = {
  paginacao: { pagina: 1, itensPorPagina: 200, quantidadePaginas: 1, quantidadeItens: 2 },
  finalizadoras: [
    {
      idFilial: 1,
      data: '2026-09-11',
      caixa: 1,
      cupom: 100234,
      especie: 'DINHEIRO',
      valor: 40,
      cancelada: ' ',
    },
    {
      idFilial: 1,
      data: '2026-09-11',
      caixa: 1,
      cupom: 100234,
      especie: 'CARTAO DEBITO',
      valor: 47.4,
      cancelada: ' ',
    },
  ],
};

export const FIXTURE_RESUMO_FILIAL = {
  paginacao: { pagina: 1, itensPorPagina: 200, quantidadePaginas: 1, quantidadeItens: 1 },
  vendas: [
    {
      idFilial: 1,
      data: '2026-09-11',
      valor: 18420.55,
      custoReal: 13890.2,
      custoSemICMS: 12990.1,
      custoComEncargos: 14210.8,
      custoMedio: 13880.4,
      custoFiscalMedio: 13790.0,
      aliquotaMediaICMS: 12.4,
      aliquotaMediaPISCOFINS: 3.65,
      quantidadeClientes: 412,
      quantidadeUnidades: 2390.5,
      produtosComVenda: 830,
      produtosEstoqueAbaixoMinimo: 57,
      produtosEstoqueNegativo: 4,
      produtosEstoqueSemVenda: 210,
      margemAcima: 300,
      margemAbaixo: 120,
      margemNegativa: 8,
      atualizouEstoque: 'S',
      gerouVendasDiaria: 'S',
      exportouVendas: ' ',
      processouScanntech: ' ',
      possuiDivergencia: ' ',
      usuarioAtualizouEstoque: 'OPERADOR01',
    },
  ],
};

/** Array puro, sem envelope — como `GET /vendascartoes` (doc 02 §3). */
export const FIXTURE_ARRAY_PURO = [
  { id: 1, descricao: 'ITEM EM ARRAY PURO' },
  { id: '2 ', descricao: 'OUTRO ITEM' },
];
