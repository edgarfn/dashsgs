# 03 — Inventário Completo da API SG Sistemas ("API SG - Terceiros")

> Fonte: coleção Postman publicada em https://api-doc.sgsistemas.com.br/ (publishDate da coleção: 2025-04-04, versionTag `latest`).
> Todos os itens abaixo são [DOCUMENTADO] — extraídos mecanicamente da coleção oficial. Nada foi inventado.

## Números gerais

| Métrica | Valor |
|---|---|
| Módulos (pastas) | 41 |
| Endpoints (requests documentados) | 105 |
| GET | 92 |
| POST | 9 |
| PATCH | 1 |
| DELETE | 3 |

Convenções da matriz:
- **Pag.** = suporta `pagina`/`itensPorPagina`
- **Data** = possui filtro por data
- **Filial** = exige/aceita parâmetro `filial`/`filiais`
- **Escrita** = altera dados no ERP (POST/PATCH/DELETE)
- Autenticação: **todos** os endpoints exigem header `Authorization` com o JWT obtido em `POST /integracao/sgsistemas/v1/autorizacao`, exceto o próprio endpoint de autorização. O endpoint `GET /sgsistemas/v1/status` não documenta header de autenticação — [NECESSITA CONFIRMAÇÃO].
- Paginação na resposta: envelope `paginacao` ou `ordenacao` (inconsistente entre módulos); dois endpoints retornam array JSON puro (`GET /vendascartoes`, `GET /pedidosvenda/produtos`).

## Matriz de endpoints

| Módulo | Request | Método | Path | Pag. | Data | Filial | Escrita |
|---|---|---|---|---|---|---|---|
| Autenticação | Chave de Autorização | POST | /integracao/sgsistemas/v1/autorizacao | N | N | N | S |
| Acerto de Estoque de Entrada | Acerto de Entrada | GET | /integracao/sgsistemas/v1/acertoestoque/entrada | S | S | S | N |
| Acerto de Estoque de Entrada | Acerto de Entrada | POST | /integracao/sgsistemas/v1/acertoestoque/entrada | N | N | N | S |
| Acerto de Estoque de Entrada | Acerto de Entrada | DELETE | /integracao/sgsistemas/v1/acertoestoque/entrada | N | N | S | S |
| Acerto de Estoque de Saída | Acerto de Saída | GET | /integracao/sgsistemas/v1/acertoestoque/saida | S | S | S | N |
| Acerto de Estoque de Saída | Acerto de Saída | POST | /integracao/sgsistemas/v1/acertoestoque/saida | N | N | N | S |
| Acerto de Estoque de Saída | Acerto de Saída | DELETE | /integracao/sgsistemas/v1/acertoestoque/saida | N | N | S | S |
| Agrupamentos | Agrupamentos | GET | /integracao/sgsistemas/v1/agrupamentos | N | N | N | N |
| Cartões | Baixa | POST | /integracao/sgsistemas/v1/vendascartoes | N | N | N | S |
| Cartões | Vendas | GET | /integracao/sgsistemas/v1/vendascartoes | N | S | S | N |
| Cartões | Vendas | PATCH | /integracao/sgsistemas/v1/vendascartoes | N | N | N | S |
| Classes | Classes | GET | /integracao/sgsistemas/v1/classes | N | N | N | N |
| Clientes | Clientes | GET | /integracao/sgsistemas/v1/clientes | S | N | N | N |
| Clientes | Clientes | POST | /integracao/sgsistemas/v1/clientes | N | N | N | S |
| Clientes | Tipos | GET | /integracao/sgsistemas/v1/clientes/tipos | N | N | N | N |
| Compradores | Compradores | GET | /integracao/sgsistemas/v1/compradores | N | N | N | N |
| Contas a Pagar | Contas a Pagar | GET | /integracao/sgsistemas/v1/contas/pagar | S | S | S | N |
| Contas a Receber | Contas a Receber | GET | /integracao/sgsistemas/v1/contas/receber | S | S | S | N |
| Departamentos | Departamentos - Nivel 1 | GET | /integracao/sgsistemas/v1/departamentos/nivel1 | N | N | N | N |
| Departamentos | Departamentos - Nivel 1 - Compradores | GET | /integracao/sgsistemas/v1/departamentos/nivel1/compradores | N | N | N | N |
| Departamentos | Departamentos - Nivel 2 | GET | /integracao/sgsistemas/v1/departamentos/nivel2 | N | N | N | N |
| Departamentos | Departamentos - Nivel 3 | GET | /integracao/sgsistemas/v1/departamentos/nivel3 | N | N | N | N |
| Departamentos | Departamentos - Nivel 4 | GET | /integracao/sgsistemas/v1/departamentos/nivel4 | N | N | N | N |
| Departamentos | Departamentos - Nivel 5 | GET | /integracao/sgsistemas/v1/departamentos/nivel5 | N | N | N | N |
| Departamentos | Departamentos - Nivel 6 | GET | /integracao/sgsistemas/v1/departamentos/nivel6 | N | N | N | N |
| Despesas | Despesas | GET | /integracao/sgsistemas/v1/despesas | S | S | S | N |
| Despesas | Departamentos Despesa - Nivel 1 | GET | /integracao/sgsistemas/v1/despesas/departamentos/nivel1 | N | N | N | N |
| Despesas | Departamentos Despesa - Nivel 2 | GET | /integracao/sgsistemas/v1/despesas/departamentos/nivel2 | N | N | N | N |
| Despesas | Departamentos Despesa - Nivel 3 | GET | /integracao/sgsistemas/v1/despesas/departamentos/nivel3 | N | N | N | N |
| Despesas | Tipos de Despesas | GET | /integracao/sgsistemas/v1/despesas/tipos | N | N | N | N |
| Filiais | Filiais | GET | /integracao/sgsistemas/v1/filiais | N | N | N | N |
| Filiais | Vendas | GET | /integracao/sgsistemas/v1/filiais/vendas | S | S | S | N |
| Formas de Pagamento | Formas de Pagamento | GET | /integracao/sgsistemas/v1/formaspagamento | N | N | N | N |
| Fornecedores | Fornecedores | GET | /integracao/sgsistemas/v1/fornecedores | N | N | N | N |
| Fornecedores | Produtos | GET | /integracao/sgsistemas/v1/fornecedores/produtos | N | N | N | N |
| Marcas | Marcas | GET | /integracao/sgsistemas/v1/marcas | N | N | N | N |
| Motivos Acerto | Motivos Acerto | GET | /integracao/sgsistemas/v1/motivosacerto | S | N | N | N |
| Motivos Perdas | Motivos Perdas | GET | /integracao/sgsistemas/v1/motivosperdas | N | N | N | N |
| Motivos Trocas | Motivos Trocas | GET | /integracao/sgsistemas/v1/motivostrocas | S | N | N | N |
| Municipios | Municipios | GET | /integracao/sgsistemas/v1/municipios | N | N | N | N |
| Notas de Entrada | Entradas | GET | /integracao/sgsistemas/v1/entradas | S | S | S | N |
| Notas de Entrada | Produtos | GET | /integracao/sgsistemas/v1/entradas/produtos | S | S | S | N |
| Notas de Entrada | Chave | GET | /integracao/sgsistemas/v1/entradas/chave | N | N | N | N |
| Notas de Entrada | Pedidos compra | GET | /integracao/sgsistemas/v1/entradas/pedidoscompra | N | N | N | N |
| Notas de Saida | Saidas | GET | /integracao/sgsistemas/v1/saidas | S | S | S | N |
| Notas de Saida | Produtos | GET | /integracao/sgsistemas/v1/saidas/produtos | N | N | S | N |
| Notas de Saida | Chave | GET | /integracao/sgsistemas/v1/saidas/chave | N | N | N | N |
| Notas de Serviço | NFS | GET | /integracao/sgsistemas/v1/nfs | S | S | S | N |
| Notas de Serviço | NFS Serviços | GET | /integracao/sgsistemas/v1/nfs/servicos | S | N | N | N |
| Observações das Notas | Observações | GET | /integracao/sgsistemas/v1/observacoes | N | N | N | N |
| Ofertas | Ofertas | GET | /integracao/sgsistemas/v1/ofertas | N | N | N | N |
| Ofertas | Produtos | GET | /integracao/sgsistemas/v1/ofertas/produtos | N | N | S | N |
| Ofertas | Produtos | POST | /integracao/sgsistemas/v1/ofertas/produtos | N | N | N | S |
| PDV | PDV | GET | /integracao/sgsistemas/v1/pdv | N | N | S | N |
| Pedidos de Compra | Pedidos de Compra | GET | /integracao/sgsistemas/v1/pedidoscompra | S | S | S | N |
| Pedidos de Compra | Pedidos de Compra | POST | /integracao/sgsistemas/v1/pedidoscompra | N | N | N | S |
| Pedidos de Compra | Produtos | GET | /integracao/sgsistemas/v1/pedidoscompra/produtos | N | N | N | N |
| Pedidos de Compra | Distribuição | GET | /integracao/sgsistemas/v1/pedidoscompra/distribuicao | N | N | N | N |
| Pedidos de Compra | Status | GET | /integracao/sgsistemas/v1/pedidoscompra/status | N | N | N | N |
| Pedidos de Venda | Pedidos de Venda | POST | /integracao/sgsistemas/v1/pedidosvenda | N | N | N | S |
| Pedidos de Venda | Pedidos de Venda | GET | /integracao/sgsistemas/v1/pedidosvenda | S | S | S | N |
| Pedidos de Venda | Produtos | GET | /integracao/sgsistemas/v1/pedidosvenda/produtos | N | N | S | N |
| Prazos para Pagamentos | Prazos | GET | /integracao/sgsistemas/v1/prazospagamento | N | N | N | N |
| Previsão de Vendas | Previsão de Vendas | GET | /integracao/sgsistemas/v1/previsaovendas | N | N | S | N |
| Previsão de Vendas | Departamentos - Nivel 1 | GET | /integracao/sgsistemas/v1/previsaovendas/departamentos/nivel1 | N | N | S | N |
| Previsão de Vendas | Departamentos - Nivel 2 | GET | /integracao/sgsistemas/v1/previsaovendas/departamentos/nivel2 | N | N | S | N |
| Previsão de Vendas | Departamentos - Nivel 3 | GET | /integracao/sgsistemas/v1/previsaovendas/departamentos/nivel3 | N | N | S | N |
| Previsão de Vendas | Departamentos - Nivel 4 | GET | /integracao/sgsistemas/v1/previsaovendas/departamentos/nivel4 | N | N | S | N |
| Previsão de Vendas | Departamentos - Nivel 5 | GET | /integracao/sgsistemas/v1/previsaovendas/departamentos/nivel5 | N | N | S | N |
| Previsão de Vendas | Departamentos - Nivel 6 | GET | /integracao/sgsistemas/v1/previsaovendas/departamentos/nivel6 | N | N | S | N |
| Previsão de Vendas | Diaria | GET | /integracao/sgsistemas/v1/previsaovendas/diaria | S | N | S | N |
| Previsão de Vendas | Marca | GET | /integracao/sgsistemas/v1/previsaovendas/marca | S | N | S | N |
| Previsão de Vendas | Produto | GET | /integracao/sgsistemas/v1/previsaovendas/produto | S | N | S | N |
| Produtos | Produtos | GET | /integracao/sgsistemas/v1/produtos | S | S | S | N |
| Produtos | Fornecedores | GET | /integracao/sgsistemas/v1/produtos/fornecedores | N | N | N | N |
| Produtos | Gondolas | GET | /integracao/sgsistemas/v1/produtos/gondolas | S | N | S | N |
| Produtos | GTINs | GET | /integracao/sgsistemas/v1/produtos/gtins | N | N | N | N |
| Produtos | GTINs | POST | /integracao/sgsistemas/v1/produtos/gtins | N | N | N | S |
| Produtos | GTINs | DELETE | /integracao/sgsistemas/v1/produtos/gtins | N | N | N | S |
| Produtos | Movimentacoes | GET | /integracao/sgsistemas/v1/produtos/movimentacoes | S | S | S | N |
| Produtos | Ofertas | GET | /integracao/sgsistemas/v1/produtos/ofertas | N | N | S | N |
| Produtos | Pedidos de Venda | GET | /integracao/sgsistemas/v1/produtos/pedidosvenda | S | N | S | N |
| Produtos | Perdas | GET | /integracao/sgsistemas/v1/produtos/perdas | S | S | S | N |
| Produtos | Precos | GET | /integracao/sgsistemas/v1/produtos/precos | N | N | S | N |
| Produtos | Tributacoes | GET | /integracao/sgsistemas/v1/produtos/tributacoes | S | N | S | N |
| Produtos | Trocas | GET | /integracao/sgsistemas/v1/produtos/trocas | S | S | S | N |
| Produtos | Vendas | GET | /integracao/sgsistemas/v1/produtos/vendas | S | S | S | N |
| Produtos | Vencimentos | GET | /integracao/sgsistemas/v1/produtos/vencimentos | S | S | S | N |
| Rotas de Entregas | Rotas | GET | /integracao/sgsistemas/v1/rotasentrega | N | N | N | N |
| Séries das Notas | Séries | GET | /integracao/sgsistemas/v1/series | S | N | S | N |
| Séries das Notas | Séries NFS | GET | /integracao/sgsistemas/v1/seriesNFS | S | N | S | N |
| Serviços | Serviços | GET | /integracao/sgsistemas/v1/servicos | S | N | S | N |
| Serviços do município | Serviços do município | GET | /integracao/sgsistemas/v1/servicosmunicipio | S | N | S | N |
| Status | Status | GET | /sgsistemas/v1/status | N | N | N | N |
| Tipos de Clientes | Tipos de Clientes | GET | /integracao/sgsistemas/v1/tiposclientes | N | N | N | N |
| Unidades de Medida | Unidades de Medida | GET | /integracao/sgsistemas/v1/unidadesmedida | N | N | N | N |
| Vendas | Vendas | GET | /integracao/sgsistemas/v1/vendas | S | S | S | N |
| Vendas | Vendas Hoje | GET | /integracao/sgsistemas/v1/vendas/hoje | S | N | S | N |
| Vendas | Finalizadoras | GET | /integracao/sgsistemas/v1/vendas/finalizadoras | S | S | S | N |
| Vendas | Finalizadoras Hoje | GET | /integracao/sgsistemas/v1/vendas/finalizadoras/hoje | S | N | S | N |
| Verbas | Verbas | GET | /integracao/sgsistemas/v1/verbas | N | S | S | N |
| Verbas | Eventos | GET | /integracao/sgsistemas/v1/verbas/eventos | N | N | N | N |
| Verbas | Formas de Pagamento | GET | /integracao/sgsistemas/v1/verbas/formaspagamento | N | N | N | N |
| Verbas | Pagas | GET | /integracao/sgsistemas/v1/verbas/pagas | N | N | N | N |
| Vendedores | Vendedores | GET | /integracao/sgsistemas/v1/vendedores | N | N | N | N |

## Inventário de recursos (visão de domínio)

Recursos disponibilizados pela API, agrupados por área de negócio. Campos citados conforme exemplos oficiais.

### Cadastros / dimensões (mestres)
| Recurso | Endpoints | Identificador | Dados pessoais? | Observações |
|---|---|---|---|---|
| Filiais | GET /filiais | id | CNPJ, razão social (PJ) | Dimensão central: quase tudo é filtrado por filial |
| Produtos | GET /produtos (+9 sub-rotas) | id | Não | Custos (5 tipos), preços, estoques, curva ABC, venda média diária, datas de alteração |
| GTINs | GET/POST/DELETE /produtos/gtins | idGTIN | Não | Código de barras por produto; escrita disponível |
| Departamentos (6 níveis) | GET /departamentos/nivel1..6 | id | Não | Hierarquia de produto; nível 1 vincula ao produto |
| Marcas / Classes / Agrupamentos | GET | id | Não | Dimensões de produto |
| Unidades de Medida | GET /unidadesmedida | id (string) | Não | |
| Fornecedores | GET /fornecedores, /fornecedores/produtos | id | CNPJ, razão social (PJ) | diasPrevisaoEntrega |
| Compradores | GET /compradores | id | Nome | |
| Clientes | GET/POST /clientes, GET /clientes/tipos, /tiposclientes | id | **SIM — CPF/CNPJ, RG/IE, endereço, telefone, celular, e-mail, gênero, nascimento, limite de crédito** | Recurso mais sensível da API (LGPD) |
| Vendedores | GET /vendedores | id | **Nome, CPF, comissões** | |
| Municípios | GET /municipios | id / idIBGE | Não | |
| Formas de Pagamento | GET /formaspagamento | id | Não | |
| Prazos de Pagamento | GET /prazospagamento | id | Não | |
| Rotas de Entrega | GET /rotasentrega | id | Não | Dias da semana, frete |
| PDV | GET /pdv | id | Não | Tipo emissor (NFCe etc.), ativo/inativo |
| Séries de notas | GET /series, /seriesNFS | id | Não | Última nota emitida por filial |
| Motivos (acerto/perdas/trocas) | GET | id | Não | Dimensões para análises |
| Serviços / Serviços do município | GET | id | Não | Tributação de serviços (ISS) |
| Status do executável | GET /sgsistemas/v1/status | — | CNPJ da filial base | Versão/revisão do ERP — útil para health-check da integração |

### Fatos / transações (leitura)
| Recurso | Endpoints | Granularidade | Restrições documentadas |
|---|---|---|---|
| Vendas PDV (dia fechado) | GET /vendas | Cupom + item | `filial` e `data` (1 dia) obrigatórios; `emitePISCOFINS=true` até 3x mais lento |
| Vendas PDV (tempo real) | GET /vendas/hoje | Cupom + item | Somente dia corrente, antes do fechamento |
| Finalizadoras (dia fechado / hoje) | GET /vendas/finalizadoras, /finalizadoras/hoje | Cupom + meio de pagamento | Idem vendas |
| Resumo diário por filial | GET /filiais/vendas | Dia × filial | Período máx. 30 dias; traz custos, nº clientes, margens, flags operacionais |
| Vendas por produto | GET /produtos/vendas | Produto × dia | `emiteCustoSemEncargos=true` até 3x mais lento |
| Movimentações de estoque | GET /produtos/movimentacoes | Produto × movimento | Período máx. 30 dias; 23 tipos de movimentação |
| Perdas | GET /produtos/perdas | Produto × data × motivo | Datas obrigatórias |
| Trocas | GET /produtos/trocas | Produto × movimento | Período máx. 30 dias |
| Vencimentos | GET /produtos/vencimentos | Produto × lote/validade | Lote depende de parametrização do cliente |
| Notas de entrada | GET /entradas (+/produtos, /chave, /pedidoscompra) | Nota + item | Situações e transações codificadas; chave NF-e 44 dígitos |
| Notas de saída | GET /saidas (+/produtos, /chave) | Nota + item | Sub-rota /produtos sem filtro de data (limitação documentada) |
| Notas de serviço | GET /nfs, /nfs/servicos | NFS + item | Tributos retidos (ISS, PIS, COFINS, CSLL, IRRF, INSS) |
| Observações de notas | GET /observacoes | Nota | Entrada ou saída |
| Contas a pagar | GET /contas/pagar | Título + parcela | Datas obrigatórias; status pagas/naoPagas |
| Contas a receber | GET /contas/receber | Título + parcela | Idem |
| Despesas | GET /despesas (+ tipos, deptos 3 níveis) | Lançamento | Datas obrigatórias; classificações documentadas |
| Cartões — vendas | GET /vendascartoes | Transação (NSU) | Retorna array puro; taxas, bandeira, adquirente |
| Verbas (trade) | GET /verbas (+eventos, formaspagamento, pagas) | Verba × parcela | Verbas de fornecedores |
| Pedidos de compra | GET /pedidoscompra (+produtos, distribuicao, status) | Pedido + item + distribuição por filial | Situações: atendido/pendente/parcial/semAceite/geradoNovoPedido |
| Pedidos de venda | GET /pedidosvenda (+produtos), GET /produtos/pedidosvenda | Pedido + item | Campo `idSubstituido`: registro deve ser desconsiderado |
| Previsão de vendas | GET /previsaovendas (+deptos 1..6, diaria, marca, produto) | Mês × filial (e recortes) | previsaoVenda, previsaoLucro, diasUteis |

### Operações de escrita no ERP
| Operação | Endpoint | Efeito no ERP | Risco |
|---|---|---|---|
| Gerar token | POST /autorizacao | — | Credencial em corpo JSON |
| Cadastrar cliente | POST /clientes | Insere em cadcli | Dados pessoais enviados |
| Acerto de estoque entrada/saída | POST /acertoestoque/entrada, /saida | Movimenta estoque (movpro) | **Alto — altera estoque real** |
| Cancelar acerto | DELETE /acertoestoque/entrada, /saida | Cancela movimento | Alto |
| Cadastrar GTIN | POST /produtos/gtins | Insere código de barras | Médio |
| Excluir GTINs | DELETE /produtos/gtins | Remove códigos | **Alto — exclusão em lote via query param** |
| Criar oferta | POST /ofertas/produtos | Muda preço promocional em loja | **Alto — impacto direto no preço de venda** |
| Criar pedido de compra | POST /pedidoscompra | Gera pedido ao fornecedor | Alto |
| Criar pedido de venda | POST /pedidosvenda | Gera pedido/venda | Alto |
| Baixa de vendas cartão | POST /vendascartoes | Baixa financeira + lançamento bancário | **Alto — mexe em conciliação financeira** |
| Alterar venda cartão | PATCH /vendascartoes | Altera taxa/bandeira/vencimento | Alto (bloqueado se já baixada) |

## Campos-chave por recurso (mapa de relacionamentos)

A documentação declara explicitamente os relacionamentos ("Response/Params/Body Relationship"). Grafo consolidado:

- `Produtos.departamentalizacaoNivel1 → Departamentos N1.id`; N1→N2→N3→N4→N5→N6 (cadeia)
- `Produtos.marca → Marcas.id`; `.classe → Classes.id`; `.agrupamento → Agrupamentos.id`; `.unidadeDeMedida → UnidadesMedida.id`; `.idUltimoComprador → Compradores.id`
- `GTINs.idProduto → Produtos.id`; `Precos.idProduto → Produtos.id`; `Ofertas(produto).idOferta → Ofertas.id`
- `Vendas.itens.idProduto → Produtos.id`; `.idGTIN → GTINs`; `.idOferta → Ofertas`; `Vendas.idCliente → Clientes.id`; `.caixa → PDV.id`; `.idVendedor → Vendedores.id`
- `Clientes.idMunicipio → Municipios.id`; `.idFormaPagamento → FormasPagamento.id`; `.tipoPrincipal → TiposClientes.id`; `.idVendedor → Vendedores.id`; `.idFilial → Filiais.id`; `.idRota → RotasEntrega.id`; `.numeroTabelaPrazosPagamento → PrazosPagamento.id`
- `Entradas/Saidas.idEntidade → Clientes|Filiais|Fornecedores` conforme `tipoEntidade` (C/E/F)
- `ContasPagar/Receber.idEntidade → Clientes|Fornecedores|Filiais` conforme `tipoEntidade`
- `PedidosCompra.idFornecedor → Fornecedores.id`; `.idComprador → Compradores.id`; `.statusPedidoIntegrado → Status(id)`
- `PedidosVenda.idCliente → Clientes.id`; `.idVendedor → Vendedores.id`; `.idPedidoCompra → PedidosCompra.id`
- `Perdas.idMotivoPerda → MotivosPerdas.id`; `Trocas.codigoMotivo → MotivosTrocas.id`; `Acertos.idMotivo → MotivosAcerto.id`
- `Despesas.idTipoDespesa → TiposDespesas.id`; `TiposDespesas.departamentalizacaoNivel1 → DeptosDespesa N1` (N1→N2→N3)
- `Verbas.parcelas.idEvento → VerbasEventos.id`; `.idFornecedor → Fornecedores.id`; `.idComprador → Compradores.id`; `.idFormaPagamento → VerbasFormasPagamento.id`

## Observações de qualidade da documentação

1. IDs do ERP são **inteiros sequenciais por instância** (não globais) — em um SaaS multi-tenant, a chave natural é sempre `(tenant, id_erp)` e, quando aplicável, `(tenant, filial, id_erp)`.
2. Alguns exemplos trazem `code: None` (sem status HTTP no exemplo) e nomes de exemplo inconsistentes — tratar códigos como indicativos, não contratuais.
3. Campos string com preenchimento a espaços (`idOferta: "5 "`, `idGondola: "TES   "`) — **trim obrigatório** na ingestão e comparações.
4. Datas: `YYYY-MM-DD`; vazias como `""` (não null). Horários `HH:MM` sem data/timezone — assumir fuso da loja [NECESSITA CONFIRMAÇÃO].
5. Booleans reais e pseudo-booleans string (`"S"`, `" "`, `"C"`) coexistem — normalizar na camada anticorrupção.
6. `GET /pedidosvenda/produtos` retornou `idGTIN: false` em exemplo — tipo instável, tratar como opcional.
7. Typos na documentação (ex.: "Scource Database", "cancelaod") não afetam contrato, mas indicam revisão manual limitada.
