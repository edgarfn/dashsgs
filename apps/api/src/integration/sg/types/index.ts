import { z } from 'zod';
import {
  SITUACAO,
  sgBooleano,
  sgData,
  sgEnum,
  sgHora,
  sgId,
  sgInteiro,
  sgNumero,
  sgTexto,
} from '../normalizers';

/**
 * Contrato tipado da API SG (doc 12 §5 e doc 03).
 *
 * Cada schema é **tolerante na entrada e estrito na saída**: aceita o que o ERP manda (padding,
 * datas vazias, char-flags, campos ausentes) e entrega um objeto limpo. Campos que o produto não
 * usa simplesmente não aparecem aqui — a allowlist é o schema, e é assim que a minimização de
 * dados do doc 10 vira código em vez de intenção.
 *
 * Cobertura desta fase: autorização, status, filiais, dimensões de produto, produtos, vendas
 * (dia fechado e tempo real), finalizadoras e resumo diário por filial — exatamente o que a
 * Fase 6 sincroniza primeiro (E5-02 a E5-06). Os demais recursos do doc 03 entram junto com o
 * respectivo job de sync, seguindo o passo-a-passo do doc 24 §7.
 */

// ---------------------------------------------------------------- autorização
export const autorizacaoResponseSchema = z
  .object({
    token: z.string().min(20),
    routes: z.array(z.string()).default([]),
    /** `YYYY-MM-DD HH:MM:SS`, sem timezone (doc 02 §2). */
    expire_time: z.string().optional(),
  })
  .passthrough()
  .transform((bruto) => ({
    token: bruto.token,
    // Rotas vêm como "MÉTODO /path"; normalizamos caixa e espaços para comparar sem susto.
    routes: bruto.routes.map((rota) => rota.trim().replace(/\s+/g, ' ').toUpperCase()),
    expireTime: bruto.expire_time?.trim() || null,
  }));
export type AutorizacaoResponse = z.infer<typeof autorizacaoResponseSchema>;

// ---------------------------------------------------------------- status (health-check)
export const statusSchema = z
  .object({
    versao: sgTexto(40),
    revisao: sgTexto(40),
    cnpj: sgTexto(20),
    razaoSocial: sgTexto(160),
  })
  .passthrough()
  .transform((bruto) => ({
    versao: bruto.versao,
    revisao: bruto.revisao,
    cnpj: bruto.cnpj,
    razaoSocial: bruto.razaoSocial,
  }));
export type SgStatus = z.infer<typeof statusSchema>;

// ---------------------------------------------------------------- filiais
export const filialSchema = z
  .object({
    id: sgId,
    razaoSocial: sgTexto(160),
    nomeFantasia: sgTexto(160),
    cnpj: sgTexto(20),
    idMunicipio: sgInteiro,
    uf: sgTexto(2),
    inativa: sgBooleano,
  })
  .passthrough()
  .transform((bruto) => ({
    erpId: Number(bruto.id),
    razaoSocial: bruto.razaoSocial ?? `Filial ${bruto.id}`,
    nomeFantasia: bruto.nomeFantasia,
    cnpj: bruto.cnpj?.replace(/\D/g, '') ?? null,
    municipioErpId: bruto.idMunicipio,
    uf: bruto.uf?.toUpperCase() ?? null,
    ativa: !bruto.inativa,
  }));
export type SgFilial = z.infer<typeof filialSchema>;

// ---------------------------------------------------------------- dimensões simples
/** Departamentos (6 níveis), marcas, classes, agrupamentos, motivos: mesmo formato id+descrição. */
export const dimensaoSchema = z
  .object({
    id: sgId,
    descricao: sgTexto(160),
    /** Nível seguinte da hierarquia de departamentos, quando houver. */
    departamentalizacaoNivel2: sgInteiro,
    departamentalizacaoNivel3: sgInteiro,
    departamentalizacaoNivel4: sgInteiro,
    departamentalizacaoNivel5: sgInteiro,
    departamentalizacaoNivel6: sgInteiro,
  })
  .passthrough()
  .transform((bruto) => ({
    erpId: bruto.id,
    descricao: bruto.descricao ?? `(sem descrição) ${bruto.id}`,
    parentNextLevelErpId:
      bruto.departamentalizacaoNivel2 ??
      bruto.departamentalizacaoNivel3 ??
      bruto.departamentalizacaoNivel4 ??
      bruto.departamentalizacaoNivel5 ??
      bruto.departamentalizacaoNivel6 ??
      null,
  }));
export type SgDimensao = z.infer<typeof dimensaoSchema>;

// ---------------------------------------------------------------- produtos
export const produtoSchema = z
  .object({
    id: sgId,
    descricao: sgTexto(160),
    idFilial: sgInteiro,
    departamentalizacaoNivel1: sgInteiro,
    marca: sgInteiro,
    classe: sgInteiro,
    agrupamento: sgInteiro,
    unidadeDeMedida: sgTexto(10),
    inativo: sgBooleano,
    balanca: sgBooleano,
    curvaABC: sgTexto(3),

    custoReal: sgNumero,
    custoFiscal: sgNumero,
    custoComEncargos: sgNumero,
    custoMedio: sgNumero,
    precoCusto: sgNumero,
    precoVenda1: sgNumero,
    precoVenda2: sgNumero,

    estoqueAtual: sgNumero,
    estoqueMinimo: sgNumero,
    estoqueMaximo: sgNumero,
    estoqueTrocas: sgNumero,
    vendaMediaDiaria: sgNumero,

    dataCadastro: sgData,
    dataAlteracaoPreco: sgData,
    dataAlteracaoCusto: sgData,
    dataAlteracaoCadastro: sgData,
  })
  .passthrough()
  .transform((bruto) => ({
    erpId: Number(bruto.id),
    filialErpId: bruto.idFilial ?? 0,
    descricao: bruto.descricao ?? `Produto ${bruto.id}`,
    dep1ErpId: bruto.departamentalizacaoNivel1,
    marcaErpId: bruto.marca,
    classeErpId: bruto.classe,
    agrupErpId: bruto.agrupamento,
    unidadeMedida: bruto.unidadeDeMedida,
    ativo: !bruto.inativo,
    balanca: bruto.balanca,
    curvaAbc: bruto.curvaABC,
    custos: {
      real: bruto.custoReal,
      fiscal: bruto.custoFiscal,
      comEncargos: bruto.custoComEncargos,
      medio: bruto.custoMedio,
      precoCusto: bruto.precoCusto,
    },
    precoVenda1: bruto.precoVenda1,
    precoVenda2: bruto.precoVenda2,
    estoqueAtual: bruto.estoqueAtual,
    estoqueMinimo: bruto.estoqueMinimo,
    estoqueMaximo: bruto.estoqueMaximo,
    estoqueTrocas: bruto.estoqueTrocas,
    vendaMediaDiaria: bruto.vendaMediaDiaria,
    dataCadastro: bruto.dataCadastro,
    dataAlteracaoPreco: bruto.dataAlteracaoPreco,
    dataAlteracaoCusto: bruto.dataAlteracaoCusto,
    dataAlteracaoCadastro: bruto.dataAlteracaoCadastro,
  }));
export type SgProduto = z.infer<typeof produtoSchema>;

export const gtinSchema = z
  .object({
    idGTIN: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    idProduto: sgId,
    quantidadePorEmbalagem: sgNumero,
  })
  .passthrough()
  .transform((bruto) => ({
    // `idGTIN: false` aparece em exemplo oficial (doc 03, observação 6) — tipo instável.
    gtin: typeof bruto.idGTIN === 'boolean' || !bruto.idGTIN ? null : String(bruto.idGTIN).trim(),
    produtoErpId: Number(bruto.idProduto),
    qtdPorEmbalagem: bruto.quantidadePorEmbalagem,
  }))
  .refine((valor) => valor.gtin !== null, { message: 'GTIN ausente' });
export type SgGtin = z.infer<typeof gtinSchema>;

// ---------------------------------------------------------------- vendas
const vendaItemSchema = z
  .object({
    ordem: sgInteiro,
    idProduto: sgInteiro,
    idGTIN: sgTexto(20),
    quantidade: sgNumero,
    precoVenda: sgNumero,
    desconto: sgNumero,
    acrescimo: sgNumero,
    cancelado: sgBooleano,
    idOferta: sgTexto(20),
    idPedidoVenda: sgInteiro,
    baseICMS: sgNumero,
    aliquotaICMS: sgNumero,
    valorICMS: sgNumero,
    basePIS: sgNumero,
    baseCOFINS: sgNumero,
    tipoTributacao: sgTexto(10),
    modeloDocumento: sgTexto(10),
  })
  .passthrough()
  .transform((bruto) => ({
    ordem: bruto.ordem ?? 0,
    produtoErpId: bruto.idProduto,
    gtin: bruto.idGTIN,
    quantidade: bruto.quantidade ?? 0,
    precoVenda: bruto.precoVenda ?? 0,
    desconto: bruto.desconto ?? 0,
    acrescimo: bruto.acrescimo ?? 0,
    cancelado: bruto.cancelado,
    ofertaErpId: bruto.idOferta,
    pedidoVendaErpId: bruto.idPedidoVenda,
    icmsBase: bruto.baseICMS,
    icmsAliq: bruto.aliquotaICMS,
    icmsValor: bruto.valorICMS,
    pisBase: bruto.basePIS,
    cofinsBase: bruto.baseCOFINS,
    tipoTributacao: bruto.tipoTributacao,
    modeloDoc: bruto.modeloDocumento,
  }));

export const vendaCupomSchema = z
  .object({
    idFilial: sgInteiro,
    data: sgData,
    caixa: sgInteiro,
    cupom: sgInteiro,
    serieNFC: sgTexto(10),
    horario: sgHora,
    idCliente: sgInteiro,
    idVendedor: sgInteiro,
    cancelada: sgBooleano,
    valorTotal: sgNumero,
    itens: z.array(vendaItemSchema).default([]),
  })
  .passthrough()
  .transform((bruto) => ({
    filialErpId: bruto.idFilial ?? 0,
    data: bruto.data,
    caixa: bruto.caixa ?? 0,
    cupom: bruto.cupom ?? 0,
    serieNfc: bruto.serieNFC,
    horario: bruto.horario,
    /**
     * O id do cliente só é persistido com o módulo Clientes habilitado (doc 10 §1). Aqui ele
     * chega, mas quem decide guardar é o job de sync — a camada de integração não persiste nada.
     */
    clienteErpId: bruto.idCliente,
    identificada: (bruto.idCliente ?? 0) > 0,
    /** `/vendas/hoje` não traz vendedor; o dia fechado traz (doc 02 §4.7). */
    vendedorErpId: bruto.idVendedor,
    cancelada: bruto.cancelada,
    valorTotal: bruto.valorTotal ?? 0,
    itens: bruto.itens,
  }));
export type SgVendaCupom = z.infer<typeof vendaCupomSchema>;

export const finalizadoraSchema = z
  .object({
    idFilial: sgInteiro,
    data: sgData,
    caixa: sgInteiro,
    cupom: sgInteiro,
    especie: sgTexto(40),
    valor: sgNumero,
    cancelada: sgBooleano,
  })
  .passthrough()
  .transform((bruto) => ({
    filialErpId: bruto.idFilial ?? 0,
    data: bruto.data,
    caixa: bruto.caixa ?? 0,
    cupom: bruto.cupom ?? 0,
    especie: bruto.especie ?? '(não informada)',
    valor: bruto.valor ?? 0,
    cancelada: bruto.cancelada,
  }));
export type SgFinalizadora = z.infer<typeof finalizadoraSchema>;

// ---------------------------------------------------------------- resumo diário por filial
export const resumoFilialSchema = z
  .object({
    idFilial: sgInteiro,
    data: sgData,
    valor: sgNumero,
    custoReal: sgNumero,
    custoSemICMS: sgNumero,
    custoComEncargos: sgNumero,
    custoMedio: sgNumero,
    custoFiscalMedio: sgNumero,
    aliquotaMediaICMS: sgNumero,
    aliquotaMediaPISCOFINS: sgNumero,
    quantidadeClientes: sgInteiro,
    quantidadeUnidades: sgNumero,
    produtosComVenda: sgInteiro,
    produtosEstoqueAbaixoMinimo: sgInteiro,
    produtosEstoqueNegativo: sgInteiro,
    produtosEstoqueSemVenda: sgInteiro,
    margemAcima: sgInteiro,
    margemAbaixo: sgInteiro,
    margemNegativa: sgInteiro,
    atualizouEstoque: sgBooleano,
    gerouVendasDiaria: sgBooleano,
    exportouVendas: sgBooleano,
    processouScanntech: sgBooleano,
    possuiDivergencia: sgBooleano,
    usuarioAtualizouEstoque: sgTexto(60),
  })
  .passthrough()
  .transform((bruto) => ({
    filialErpId: bruto.idFilial ?? 0,
    data: bruto.data,
    valor: bruto.valor ?? 0,
    custos: {
      real: bruto.custoReal,
      semIcms: bruto.custoSemICMS,
      comEncargos: bruto.custoComEncargos,
      medio: bruto.custoMedio,
      fiscalMedio: bruto.custoFiscalMedio,
    },
    aliqMediaIcms: bruto.aliquotaMediaICMS,
    aliqMediaPisCofins: bruto.aliquotaMediaPISCOFINS,
    qtdClientes: bruto.quantidadeClientes,
    qtdUnidades: bruto.quantidadeUnidades,
    prodComVenda: bruto.produtosComVenda,
    prodEstoqueAbaixoMin: bruto.produtosEstoqueAbaixoMinimo,
    prodEstoqueNegativo: bruto.produtosEstoqueNegativo,
    prodEstoqueSemVenda: bruto.produtosEstoqueSemVenda,
    margemAcima: bruto.margemAcima,
    margemAbaixo: bruto.margemAbaixo,
    margemNegativa: bruto.margemNegativa,
    /** Flags de fechamento: orquestram a consolidação do dia (doc 02 §7.6). */
    fechamento: {
      atualizouEstoque: bruto.atualizouEstoque,
      gerouVendasDiaria: bruto.gerouVendasDiaria,
      exportouVendas: bruto.exportouVendas,
      processouScanntech: bruto.processouScanntech,
      possuiDivergencia: bruto.possuiDivergencia,
      usuario: bruto.usuarioAtualizouEstoque,
    },
  }));
export type SgResumoFilial = z.infer<typeof resumoFilialSchema>;

// ---------------------------------------------------------------- financeiro
/**
 * Contas a pagar e a receber (doc 03 §Financeiro).
 *
 * Título e parcelas vêm aninhados, como em vendas/itens. O nome exato de cada campo ainda é
 * [NECESSITA CONFIRMAÇÃO] contra a homologação — o teste de contrato noturno é quem responde.
 * Enquanto isso, o schema é tolerante: campo que não bater vira `null`, e item que não bater vai
 * para a quarentena com métrica, em vez de derrubar a sincronização.
 */
const parcelaSchema = z
  .object({
    ordem: sgInteiro,
    dataVencimento: sgData,
    dataPagamento: sgData,
    valorDocumento: sgNumero,
    valorPago: sgNumero,
    saldo: sgNumero,
    juros: sgNumero,
    desconto: sgNumero,
    status: sgTexto(30),
    tipoLancamento: sgTexto(40),
  })
  .passthrough()
  .transform((bruto) => ({
    ordem: bruto.ordem ?? 0,
    dataVencimento: bruto.dataVencimento,
    dataPagamento: bruto.dataPagamento,
    valorDocumento: bruto.valorDocumento,
    valorPago: bruto.valorPago,
    saldo: bruto.saldo,
    juros: bruto.juros,
    desconto: bruto.desconto,
    /** A API marca o status em texto; o produto guarda o booleano, que é o que a tela pergunta. */
    paga:
      (bruto.status ?? '').toLowerCase().startsWith('pag') || (bruto.dataPagamento ?? '') !== '',
    tipoLancamento: bruto.tipoLancamento,
  }));

export const contaPagarSchema = z
  .object({
    id: sgId,
    idFilial: sgInteiro,
    idFornecedor: sgInteiro,
    documento: sgTexto(40),
    dataEmissao: sgData,
    valorTotal: sgNumero,
    observacao: sgTexto(300),
    parcelas: z.array(parcelaSchema).default([]),
  })
  .passthrough()
  .transform((bruto) => ({
    erpId: Number(bruto.id),
    filialErpId: bruto.idFilial,
    fornecedorErpId: bruto.idFornecedor,
    documento: bruto.documento,
    dataEmissao: bruto.dataEmissao,
    valorTotal: bruto.valorTotal,
    observacao: bruto.observacao,
    parcelas: bruto.parcelas,
  }));
export type SgContaPagar = z.infer<typeof contaPagarSchema>;

export const contaReceberSchema = z
  .object({
    id: sgId,
    idFilial: sgInteiro,
    idCliente: sgInteiro,
    documento: sgTexto(40),
    dataEmissao: sgData,
    valorTotal: sgNumero,
    parcelas: z.array(parcelaSchema).default([]),
  })
  .passthrough()
  .transform((bruto) => ({
    erpId: Number(bruto.id),
    filialErpId: bruto.idFilial,
    /** Id de cliente só é persistido com o módulo Clientes ligado (doc 10 §1). */
    clienteErpId: bruto.idCliente,
    documento: bruto.documento,
    dataEmissao: bruto.dataEmissao,
    valorTotal: bruto.valorTotal,
    parcelas: bruto.parcelas,
  }));
export type SgContaReceber = z.infer<typeof contaReceberSchema>;

export const tipoDespesaSchema = z
  .object({
    id: sgId,
    descricao: sgTexto(160),
    classificacao: sgTexto(40),
    tipoCusto: sgTexto(40),
    departamentalizacaoNivel1: sgId.optional(),
  })
  .passthrough()
  .transform((bruto) => ({
    erpId: bruto.id,
    descricao: bruto.descricao ?? `(sem descrição) ${bruto.id}`,
    classificacao: bruto.classificacao,
    tipoCusto: bruto.tipoCusto,
    dep1ErpId: bruto.departamentalizacaoNivel1 ?? null,
  }));
export type SgTipoDespesa = z.infer<typeof tipoDespesaSchema>;

export const despesaSchema = z
  .object({
    idFilial: sgInteiro,
    dataDespesa: sgData,
    sequencia: sgInteiro,
    idTipoDespesa: sgId.optional(),
    idFornecedor: sgInteiro,
    dataEmissao: sgData,
    valor: sgNumero,
    classificacao: sgTexto(40),
    usuario: sgTexto(60),
    observacao: sgTexto(300),
  })
  .passthrough()
  .transform((bruto) => ({
    filialErpId: bruto.idFilial ?? 0,
    dataDespesa: bruto.dataDespesa,
    sequencia: bruto.sequencia ?? 0,
    tipoDespesaErpId: bruto.idTipoDespesa ?? null,
    fornecedorErpId: bruto.idFornecedor,
    dataEmissao: bruto.dataEmissao,
    valor: bruto.valor ?? 0,
    classificacao: bruto.classificacao,
    /** Usuário do ERP é dado de colaborador (doc 02): entra no espelho, não vai para a tela. */
    usuarioErp: bruto.usuario,
    observacao: bruto.observacao,
  }))
  .refine((valor) => valor.dataDespesa !== null, { message: 'despesa sem data' });
export type SgDespesa = z.infer<typeof despesaSchema>;

/** Transação de cartão. Este endpoint devolve **array puro**, sem envelope (doc 02 §3). */
export const cartaoVendaSchema = z
  .object({
    chaveVenda: sgTexto(60),
    idFilial: sgInteiro,
    nsu: sgTexto(40),
    dataVenda: sgData,
    dataVencimento: sgData,
    valorBruto: sgNumero,
    taxa: sgNumero,
    tipoVenda: sgTexto(40),
    formaPagamento: sgTexto(40),
    descricaoBandeira: sgTexto(60),
    descricaoAdquirente: sgTexto(60),
    parcela: sgInteiro,
    baixada: sgBooleano,
  })
  .passthrough()
  .transform((bruto) => ({
    chaveVenda: bruto.chaveVenda,
    filialErpId: bruto.idFilial ?? 0,
    nsu: bruto.nsu,
    dataVenda: bruto.dataVenda,
    dataVencimento: bruto.dataVencimento,
    valorBruto: bruto.valorBruto ?? 0,
    taxaPct: bruto.taxa,
    tipoVenda: bruto.tipoVenda,
    formaPagamento: bruto.formaPagamento,
    bandeira: bruto.descricaoBandeira,
    adquirente: bruto.descricaoAdquirente,
    parcela: bruto.parcela,
    baixada: bruto.baixada,
  }))
  .refine((valor) => valor.chaveVenda !== null, { message: 'transação sem chave' });
export type SgCartaoVenda = z.infer<typeof cartaoVendaSchema>;

// ---------------------------------------------------------------- compras
export const pedidoCompraSchema = z
  .object({
    id: sgId,
    idFilial: sgInteiro,
    idFornecedor: sgInteiro,
    idComprador: sgInteiro,
    dataPedido: sgData,
    dataPrevisao: sgData,
    dataAtendimento: sgData,
    situacao: sgTexto(30),
    valorTotal: sgNumero,
    valorFrete: sgNumero,
  })
  .passthrough()
  .transform((bruto) => ({
    erpId: Number(bruto.id),
    filialErpId: bruto.idFilial,
    fornecedorErpId: bruto.idFornecedor,
    compradorErpId: bruto.idComprador,
    dataPedido: bruto.dataPedido,
    dataPrevisao: bruto.dataPrevisao,
    dataAtendimento: bruto.dataAtendimento,
    situacao: bruto.situacao,
    valorTotal: bruto.valorTotal,
    valorFrete: bruto.valorFrete,
  }));
export type SgPedidoCompra = z.infer<typeof pedidoCompraSchema>;

export const notaEntradaSchema = z
  .object({
    id: sgId,
    idFilial: sgInteiro,
    idFornecedor: sgInteiro,
    numero: sgTexto(20),
    serie: sgTexto(10),
    dataEmissao: sgData,
    dataEntrada: sgData,
    valorTotal: sgNumero,
    situacao: sgTexto(30),
  })
  .passthrough()
  .transform((bruto) => ({
    erpId: Number(bruto.id),
    filialErpId: bruto.idFilial,
    fornecedorErpId: bruto.idFornecedor,
    numero: bruto.numero,
    serie: bruto.serie,
    dataEmissao: bruto.dataEmissao,
    dataEntrada: bruto.dataEntrada,
    valorTotal: bruto.valorTotal,
    situacao: bruto.situacao,
    // A chave da NF-e (44 dígitos) é SECURITY_SENSITIVE no doc 05 e não entra no espelho enquanto
    // nenhuma tela precisar dela: campo que não existe não vaza.
  }));
export type SgNotaEntrada = z.infer<typeof notaEntradaSchema>;

// ---------------------------------------------------------------- previsão de vendas
/**
 * Previsão de vendas por mês e filial (doc 03 §Previsão de Vendas / E5-11).
 *
 * [NECESSITA CONFIRMAÇÃO] Os nomes de campo e o formato da competência vêm do doc 03 e ainda não
 * foram confirmados contra a homologação. O schema aceita as duas formas que a API usa em outros
 * módulos — competência como data (`2026-09-01`) ou como par mês/ano — e normaliza para o
 * primeiro dia do mês, que é como o espelho guarda. Campo com outro nome cai na quarentena e o
 * contrato noturno acusa, em vez de a tela de metas aparecer vazia para o primeiro cliente.
 */
export const previsaoVendasSchema = z
  .object({
    idFilial: sgInteiro,
    competencia: sgData,
    mes: sgInteiro,
    ano: sgInteiro,
    previsaoVenda: sgNumero,
    previsaoLucro: sgNumero,
    diasUteis: sgInteiro,
  })
  .passthrough()
  .transform((bruto) => ({
    filialErpId: bruto.idFilial,
    competencia: primeiroDiaDoMes(bruto.competencia, bruto.ano, bruto.mes),
    previsaoVenda: bruto.previsaoVenda,
    previsaoLucro: bruto.previsaoLucro,
    diasUteis: bruto.diasUteis,
  }))
  // Previsão sem filial, sem competência ou sem valor não é previsão: é linha vazia, e deixá-la
  // entrar faria a tela dividir por zero em silêncio.
  .refine(
    (item) => item.filialErpId !== null && item.competencia !== null && item.previsaoVenda !== null,
    { message: 'previsão sem filial, competência ou valor' },
  );
export type SgPrevisaoVendas = z.infer<typeof previsaoVendasSchema>;

export const previsaoVendasDiariaSchema = z
  .object({
    idFilial: sgInteiro,
    data: sgData,
    previsaoVenda: sgNumero,
  })
  .passthrough()
  .transform((bruto) => ({
    filialErpId: bruto.idFilial,
    data: bruto.data,
    previsaoVenda: bruto.previsaoVenda,
  }))
  .refine(
    (item) => item.filialErpId !== null && item.data !== null && item.previsaoVenda !== null,
    { message: 'previsão diária sem filial, data ou valor' },
  );
export type SgPrevisaoVendasDiaria = z.infer<typeof previsaoVendasDiariaSchema>;

/**
 * Normaliza a competência para `YYYY-MM-01`.
 *
 * O primeiro dia do mês é a única forma que compara com `data` de venda sem conversão no SQL — e
 * guardar "09/2026" como texto transformaria toda consulta de meta numa conversão por linha.
 */
function primeiroDiaDoMes(
  competencia: string | null,
  ano: number | null,
  mes: number | null,
): string | null {
  if (competencia) return `${competencia.slice(0, 7)}-01`;
  if (ano && mes && mes >= 1 && mes <= 12) {
    return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-01`;
  }
  return null;
}

// ---------------------------------------------------------------- erro da API
export const sgErroSchema = z
  .object({ error: z.string() })
  .passthrough()
  .transform((bruto) => bruto.error.trim());

export const situacaoEnum = sgEnum(SITUACAO, 'normal');
