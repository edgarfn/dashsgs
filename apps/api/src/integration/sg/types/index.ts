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

// ---------------------------------------------------------------- erro da API
export const sgErroSchema = z
  .object({ error: z.string() })
  .passthrough()
  .transform((bruto) => bruto.error.trim());

export const situacaoEnum = sgEnum(SITUACAO, 'normal');
