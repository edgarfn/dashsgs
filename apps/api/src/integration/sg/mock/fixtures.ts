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
    'GET /produtos/gtins',
    'GET /contas/pagar',
    'GET /contas/receber',
    'GET /despesas',
    'GET /despesas/tipos',
    'GET /vendascartoes',
    'GET /pedidoscompra',
    'GET /entradas',
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

/** GTINs: um normal, um com quantidade por embalagem e um com `idGTIN: false` (drift real). */
export const FIXTURE_GTINS = {
  paginacao: { pagina: 1, itensPorPagina: 500, quantidadePaginas: 1, quantidadeItens: 3 },
  gtins: [
    { idGTIN: '7891234567890', idProduto: '1001', quantidadePorEmbalagem: 1 },
    { idGTIN: '7891234567891 ', idProduto: 1002, quantidadePorEmbalagem: '12' },
    { idGTIN: false, idProduto: 1003, quantidadePorEmbalagem: 1 },
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

/** Finalizadoras do cupom que `/vendas/hoje` devolve — mesma chave (caixa 1, cupom 100301). */
export const FIXTURE_FINALIZADORAS_HOJE = {
  paginacao: { pagina: 1, itensPorPagina: 200, quantidadePaginas: 1, quantidadeItens: 2 },
  finalizadoras: [
    {
      idFilial: 1,
      data: '2026-09-12',
      caixa: 1,
      cupom: 100301,
      especie: 'PIX',
      valor: 20,
      cancelada: ' ',
    },
    {
      idFilial: 1,
      data: '2026-09-12',
      caixa: 1,
      cupom: 100301,
      especie: 'DINHEIRO',
      valor: 22.3,
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

/** Contas a pagar: título com parcelas, uma paga e duas em aberto (uma delas vencendo). */
export const FIXTURE_CONTAS_PAGAR = {
  paginacao: { pagina: 1, itensPorPagina: 200, quantidadePaginas: 1, quantidadeItens: 2 },
  contas: [
    {
      id: 9001,
      idFilial: 1,
      idFornecedor: 501,
      documento: 'NF 12345 ',
      dataEmissao: '2026-08-20',
      valorTotal: '4.500,00',
      observacao: 'Compra de mercearia',
      parcelas: [
        {
          ordem: 1,
          dataVencimento: '2026-09-05',
          dataPagamento: '2026-09-05',
          valorDocumento: 1500,
          valorPago: 1500,
          saldo: 0,
          status: 'Paga',
          tipoLancamento: 'DUPLICATA',
        },
        {
          ordem: 2,
          dataVencimento: '2026-09-20',
          dataPagamento: '',
          valorDocumento: 1500,
          valorPago: 0,
          saldo: 1500,
          status: 'Nao paga',
          tipoLancamento: 'DUPLICATA',
        },
        {
          ordem: 3,
          dataVencimento: '2026-10-05',
          dataPagamento: '0000-00-00',
          valorDocumento: 1500,
          valorPago: 0,
          saldo: 1500,
          status: 'Nao paga',
          tipoLancamento: 'DUPLICATA',
        },
      ],
    },
    {
      id: '9002 ',
      idFilial: 2,
      idFornecedor: 502,
      documento: 'NF 12346',
      dataEmissao: '2026-07-15',
      valorTotal: 980.5,
      parcelas: [
        {
          ordem: 1,
          dataVencimento: '2026-08-30',
          dataPagamento: '',
          valorDocumento: 980.5,
          valorPago: 0,
          saldo: 980.5,
          status: 'Nao paga',
        },
      ],
    },
  ],
};

export const FIXTURE_CONTAS_RECEBER = {
  paginacao: { pagina: 1, itensPorPagina: 200, quantidadePaginas: 1, quantidadeItens: 1 },
  contas: [
    {
      id: 7001,
      idFilial: 1,
      idCliente: 4711,
      documento: 'CRED 778',
      dataEmissao: '2026-09-01',
      valorTotal: 320,
      parcelas: [
        {
          ordem: 1,
          dataVencimento: '2026-09-30',
          dataPagamento: '',
          valorDocumento: 320,
          valorPago: 0,
          saldo: 320,
          juros: 0,
          desconto: 0,
          status: 'Nao paga',
        },
      ],
    },
  ],
};

/** Tipos de despesa com a classificação que separa fixo de variável (doc 15 §5). */
export const FIXTURE_TIPOS_DESPESA = {
  ordenacao: { pagina: 1, itensPorPagina: 100, quantidadePaginas: 1, quantidadeItens: 3 },
  tipos: [
    { id: '10', descricao: 'ENERGIA ELETRICA', classificacao: 'FIXA', tipoCusto: 'OPERACIONAL' },
    { id: 11, descricao: 'FRETE  ', classificacao: 'VARIAVEL', tipoCusto: 'OPERACIONAL' },
    { id: 12, descricao: 'MANUTENCAO', classificacao: 'VARIAVEL', tipoCusto: 'ADMINISTRATIVO' },
  ],
};

export const FIXTURE_DESPESAS = {
  paginacao: { pagina: 1, itensPorPagina: 200, quantidadePaginas: 1, quantidadeItens: 3 },
  despesas: [
    {
      idFilial: 1,
      dataDespesa: '2026-09-10',
      sequencia: 1,
      idTipoDespesa: '10',
      idFornecedor: 601,
      dataEmissao: '2026-09-08',
      valor: '1.240,75',
      classificacao: 'FIXA',
      usuario: 'OPERADOR01',
      observacao: 'Conta de luz',
    },
    {
      idFilial: 1,
      dataDespesa: '2026-09-11',
      sequencia: 1,
      idTipoDespesa: 11,
      idFornecedor: 602,
      valor: 380,
      classificacao: 'VARIAVEL',
      usuario: 'OPERADOR02',
    },
    {
      idFilial: 2,
      dataDespesa: '2026-09-11',
      sequencia: 1,
      idTipoDespesa: '12',
      valor: 150.9,
      classificacao: 'VARIAVEL',
    },
  ],
};

/** Cartões: **array puro**, sem envelope — a inconsistência documentada no doc 02 §3. */
export const FIXTURE_CARTOES = [
  {
    chaveVenda: 'CV-0001',
    idFilial: 1,
    nsu: '889900',
    dataVenda: '2026-09-10',
    dataVencimento: '2026-10-10',
    valorBruto: 250.4,
    taxa: 2.99,
    tipoVenda: 'CREDITO',
    formaPagamento: 'CARTAO',
    descricaoBandeira: 'VISA',
    descricaoAdquirente: 'CIELO',
    parcela: 1,
    baixada: 'S',
  },
  {
    chaveVenda: 'CV-0002 ',
    idFilial: 1,
    nsu: '889901',
    dataVenda: '2026-09-11',
    dataVencimento: '2026-10-11',
    valorBruto: '1.100,00',
    taxa: 1.49,
    tipoVenda: 'DEBITO',
    formaPagamento: 'CARTAO',
    descricaoBandeira: 'MASTERCARD',
    descricaoAdquirente: 'REDE',
    parcela: 1,
    baixada: ' ',
  },
  {
    chaveVenda: 'CV-0003',
    idFilial: 2,
    nsu: '889902',
    dataVenda: '2026-09-01',
    dataVencimento: '2026-10-01',
    valorBruto: 640,
    taxa: 3.49,
    tipoVenda: 'CREDITO',
    formaPagamento: 'CARTAO',
    descricaoBandeira: 'ELO',
    descricaoAdquirente: 'CIELO',
    parcela: 3,
    baixada: ' ',
  },
];

export const FIXTURE_PEDIDOS_COMPRA = {
  paginacao: { pagina: 1, itensPorPagina: 200, quantidadePaginas: 1, quantidadeItens: 3 },
  pedidos: [
    {
      id: 3001,
      idFilial: 1,
      idFornecedor: 501,
      idComprador: 21,
      dataPedido: '2026-09-01',
      dataPrevisao: '2026-09-05',
      dataAtendimento: '2026-09-06',
      situacao: 'atendido',
      valorTotal: 12450.9,
      valorFrete: 320,
    },
    {
      id: 3002,
      idFilial: 1,
      idFornecedor: 502,
      idComprador: 21,
      dataPedido: '2026-08-20',
      dataPrevisao: '2026-08-28',
      dataAtendimento: '',
      situacao: 'pendente',
      valorTotal: 5400,
      valorFrete: 0,
    },
    {
      id: '3003 ',
      idFilial: 2,
      idFornecedor: 503,
      idComprador: 22,
      dataPedido: '2026-09-09',
      dataPrevisao: '2026-09-16',
      dataAtendimento: '',
      situacao: 'parcial',
      valorTotal: 2300.55,
    },
  ],
};

export const FIXTURE_ENTRADAS = {
  paginacao: { pagina: 1, itensPorPagina: 200, quantidadePaginas: 1, quantidadeItens: 2 },
  entradas: [
    {
      id: 8001,
      idFilial: 1,
      idFornecedor: 501,
      numero: '12345',
      serie: '1',
      dataEmissao: '2026-09-04',
      dataEntrada: '2026-09-06',
      valorTotal: 12450.9,
      situacao: 'normal',
    },
    {
      id: 8002,
      idFilial: 2,
      idFornecedor: 503,
      numero: '998',
      serie: '1',
      dataEmissao: '2026-09-10',
      dataEntrada: '2026-09-11',
      valorTotal: 2300.55,
      situacao: 'normal',
    },
  ],
};
