# 01 — Domínio de Negócio

## Contexto

A SG Sistemas fornece ERP para varejo alimentar (supermercados, redes com filiais, atacarejo).
A API "Terceiros" existe para integradores: apps de fidelidade (há campo `integracoes.mercafacil`
nas vendas [DOCUMENTADO]), conciliadores de cartão, e-commerce, BI etc.

O cliente-alvo do DashSGS é o **dono/gestor de rede de supermercados** que usa o ERP SG e precisa
de visão consolidada e alertas sem depender de relatórios manuais do retaguarda.

## Entidades de negócio (como a API as modela)

### Estrutura organizacional
- **Filial**: unidade da empresa (loja, depósito, depósito fechado). Possui CNPJ próprio.
  Quase todas as consultas exigem `filial`. Uma instância do ERP atende N filiais.
- **PDV (caixa)**: ponto de venda da frente de caixa; emite NFC-e (modelo 65) ou NF (modelo 55/01).

### Mercadológico
- **Produto**: item comercializável. Atributos econômicos ricos: `custoReal`, `custoFiscal`,
  `custoComEncargos`, `custoMedio`, `precoDeCusto`, `precoDeVenda1/2`, `estoqueAtual/Minimo/Maximo`,
  `curvaABC`, `vendaMediaDiaria`, datas de alteração de preço/custo/cadastro.
- **GTIN**: código de barras (1:N com produto; inclui códigos internos de balança).
- **Departamentalização em 6 níveis** (nível 1 vinculado ao produto), + **Marca**, **Classe**,
  **Agrupamento**, **Unidade de Medida**.
- **Balança**: produtos pesáveis (`balanca`: P/F/U/E) — relevante para perecíveis.

### Ciclo de venda
- **Venda PDV**: cupom com itens, cliente opcional (`idCliente`=0 quando não identificado),
  tributos por item (ICMS/PIS/COFINS/FECOP), oferta aplicada (`idOferta`), vendedor.
  Dois regimes: **dia fechado** (`/vendas`, após "geração de vendas diárias" no ERP) e
  **tempo real** (`/vendas/hoje`, tabela volátil antes do fechamento).
- **Finalizadora**: meio de pagamento do cupom (DINHEIRO, TEF, TROCO...).
- **Pedido de Venda**: venda B2B/entrega gerada pelo integrador ou ERP; tem rota de entrega, prazos,
  frete; `idSubstituido` indica pedido substituído (desconsiderar o registro antigo).
- **Resumo diário por filial** (`/filiais/vendas`): venda total, custos, nº de clientes (cupons),
  unidades vendidas, contagens de produtos em ruptura/estoque negativo/margem fora do padrão e
  **flags do fechamento** (`atualizouEstoque`, `gerouVendasDiaria`, `exportouVendas`,
  `processouScanntech`, `possuiDivergencia`).

### Ciclo de compra e estoque
- **Pedido de Compra**: pedido a fornecedor com itens, distribuição por filial e situações
  (`atendido/pendente/parcial/semAceite/geradoNovoPedido`); vínculo com notas de entrada.
- **Nota de Entrada/Saída**: documentos fiscais com itens e ~60 campos tributários por item;
  chave NF-e de 44 dígitos disponível.
- **Movimentação de estoque**: 23 tipos (compra, venda, transferência, perda, acerto, balanço...).
- **Acerto de Estoque** (entrada/saída): ajuste manual com motivo — API permite criar e cancelar.
- **Perda**: baixa por motivo (deterioração etc.). **Troca**: movimentação de troca com motivo.
- **Vencimento**: data de validade por produto (e lote, se o cliente parametrizar).

### Financeiro
- **Contas a Pagar/Receber**: título → parcelas, entidade (cliente/fornecedor/filial), juros,
  status paga/não paga, datas de emissão/vencimento/pagamento.
- **Despesa**: lançamento com tipo (classificação fixa/variável/não operacional) e
  departamentalização própria de 3 níveis.
- **Vendas Cartões**: transações TEF/POS com NSU, bandeira, adquirente, taxas; API permite
  **baixa** (conciliação) e **correção** de transações não baixadas.
- **Verba**: acordo comercial com fornecedor (bonificação, conta corrente, rebaixe de preço),
  parcelas e pagamentos.

### Comercial
- **Oferta**: tipos documentados (Normal, por quantidade, por CPF/dia, controlada por venda);
  vigência por filial; pode ser restrita a um GTIN ou a clientes fidelizados; API permite criar.
- **Previsão de Vendas**: meta mensal de venda e lucro por filial, com recortes por departamento
  (6 níveis), marca, produto e dia.
- **Cliente**: consumidor ou PJ, com crédito (limite, prazos, dia de vencimento), rota de entrega,
  vendedor. **Contém a maior densidade de dados pessoais da API.**
- **Vendedor**: nome, CPF, comissões à vista/prazo, dias de rota.

## Glossário rápido

| Termo | Significado |
|---|---|
| Retaguarda | Módulo administrativo do ERP (backoffice da loja) |
| Frente de caixa | PDV — sistema dos caixas |
| Fechamento / geração de vendas diárias | Rotina do ERP que consolida as vendas do dia; muda a fonte dos dados de `/vendas/hoje` (ffdd) para `/vendas` (logpdv/regsai) |
| Finalizadora | Meio de pagamento na venda |
| Curva ABC | Classificação de produto por relevância de venda |
| Verba | Acordo/valor negociado com fornecedor |
| NSU | Número sequencial único da transação de cartão |
| SG Cloud | Modalidade de hospedagem da SG; muda o path de autenticação (`/public/...`) [DOCUMENTADO] |
| Scanntech | Integração de trade marketing citada em flag do resumo diário |
| Mercafácil | Integração de CRM/fidelidade citada no payload de vendas |

## Regras de negócio explicitamente documentadas na API

1. Token dura 1 h; credenciais fornecidas pelo comercial da SG.
2. Períodos de consulta limitados a 30 dias em: movimentações, trocas, resumo diário de vendas.
3. `/vendas/finalizadoras/hoje` disponível **apenas antes** do fechamento diário via ERP.
4. Oferta com `quantidade` (tipo "Controla quantidade vendida"): a geração de vendas diárias
   encerra a oferta automaticamente ao atingir a quantidade.
5. Vendas de cartão já baixadas não podem ser alteradas via PATCH.
6. Pedido de venda: se endereço de entrega não enviado, herda do cadastro do cliente.
7. Acerto de estoque: `precoUnitario` obrigatório apenas se o campo parametrizado de custo do
   produto estiver vazio; `quantidadeEmbalagem` usada quando a filial é depósito.
8. `idPedidoIntegrado = 0` em pedido de compra ⇒ pedido criado no próprio ERP.
9. Cliente PJ: `inscricaoEstadualRG` obrigatória; campos `**` dependem de parametrização do menu
   do cliente no ERP.
10. Em `/pedidosvenda`, registro com `idSubstituido` preenchido deve ser ignorado em favor do novo.
