# 15 — Especificação do Dashboard

Todos os indicadores abaixo derivam **exclusivamente** de dados documentados da API (coluna
Fonte). Frequência = frescor do dado conforme cadências do doc 14. Acesso respeita RBAC (doc 07)
e `filiais_allowed`. Filtros globais: período, filial(is), comparação (período anterior / ano
anterior).

## 1. Visão Executiva (home)

| Indicador | Cálculo | Fonte (endpoint) | Frescor | Acesso |
|---|---|---|---|---|
| Venda de hoje (R$, por filial e total) | Σ `valorTotal` cupons não cancelados | /vendas/hoje | 5 min | todos |
| Cupons hoje / Ticket médio hoje | count cupons; venda/cupons | /vendas/hoje | 5 min | todos |
| Venda por hora (curva do dia) | Σ por `horario` truncado à hora, sobreposta à média das 4 mesmas semanas | /vendas/hoje + histórico /vendas | 5 min | todos |
| Atingimento da meta do mês | (Σ venda mês ÷ `previsaoVenda`) ; ritmo = projeção linear por `diasUteis` | /filiais/vendas + /previsaovendas | 30 min | todos |
| Venda D-1 vs D-1 semana anterior | resumo diário | /filiais/vendas | pós-fechamento | todos |
| Margem bruta D-1 | (venda − custo escolhido*) ÷ venda; * custo configurável: real/médio/com encargos | /filiais/vendas (5 custos) | pós-fechamento | manager+ |
| Clientes atendidos D-1 / ticket médio D-1 | `quantidadeClientes`; valor÷clientes | /filiais/vendas | pós-fechamento | todos |
| Status do fechamento por filial | flags `atualizouEstoque, gerouVendasDiaria, exportouVendas, possuiDivergencia` | /filiais/vendas | 30 min | manager+ |
| Saúde da integração | último sync, status conexão, rotas contratadas | interno + /status | 10 min | admin |

## 2. Vendas (análise)

| Indicador | Cálculo | Fonte |
|---|---|---|
| Venda por filial×dia (heatmap/série) | Σ resumo diário | /filiais/vendas |
| Venda por departamento (nível 1→6 drill) | Σ itens × join produto→departamentos | /vendas + /produtos + /departamentos/nivel1..6 |
| Venda por produto (top N, cauda) | Σ `quantidadeVendida×precoVenda − descontos` | /vendas (itens) ou /produtos/vendas |
| Venda por vendedor | Σ cupons por `idVendedor` (dia fechado) | /vendas + /vendedores |
| Participação por meio de pagamento | Σ finalizadoras por `especie` | /vendas/finalizadoras |
| Vendas canceladas (R$, %, por caixa) | cupons `cancelada=true` | /vendas |
| Desconto concedido | Σ `valorDesconto` itens; % sobre venda | /vendas |
| Efetividade de ofertas | venda de itens com `idOferta` preenchido vs preço normal; por oferta | /vendas + /ofertas + /ofertas/produtos |
| Itens por cupom | Σ itens ÷ cupons | /vendas |
| Comparativo entre filiais (mesmo período) | ranking normalizado | /filiais/vendas |

## 3. Margem & Custos

| Indicador | Cálculo | Fonte |
|---|---|---|
| Margem por dia/filial | resumo diário (5 custos) | /filiais/vendas |
| Margem por produto | preço médio de venda vs custos retornados | /produtos/vendas (custos), /produtos |
| Produtos com margem negativa/abaixo da tradicional | contagens do resumo + lista via produto | /filiais/vendas + /produtos/vendas |
| Alteração de custo recente sem alteração de preço | `dataAlteracaoCusto > dataAlteracaoPreco` | /produtos (filtros de data) |
| Carga tributária média | `aliquotaMediaICMS`, `aliquotaMediaPISCOFINS` | /filiais/vendas |

## 4. Estoque & Perdas

| Indicador | Cálculo | Fonte |
|---|---|---|
| Ruptura (estoque < mínimo) | lista + contagem; tendência diária | /produtos (estoqueAtual/Minimo) + contagem em /filiais/vendas |
| Estoque negativo | `estoqueAtual < 0` | /produtos |
| Cobertura de estoque (dias) | `estoqueAtual ÷ vendaMediaDiaria` | /produtos |
| Excesso (acima do máximo) | `estoqueAtual > estoqueMaximo` | /produtos |
| Perdas por motivo/período (R$, qtd) | Σ `valorPerda` por `idMotivoPerda` | /produtos/perdas + /motivosperdas |
| Perdas % da venda | perdas ÷ venda do período | + /filiais/vendas |
| Trocas por motivo | Σ movimentos | /produtos/trocas + /motivostrocas |
| Produtos a vencer (7/15/30 dias) | `data_vencimento − hoje` por faixa | /produtos/vencimentos |
| Movimentações atípicas | acertos (tipo A/*) fora de padrão por produto | /produtos/movimentacoes + /motivosacerto |
| Curva ABC × ruptura | cruzamento: itens A em ruptura = alerta crítico | /produtos |

## 5. Financeiro

| Indicador | Cálculo | Fonte |
|---|---|---|
| Aging a pagar/receber | buckets por `dataVencimento` × `status` | /contas/pagar, /contas/receber |
| Fluxo previsto (30/60/90) | Σ parcelas em aberto por semana | idem |
| Despesas por tipo/departamento | Σ por `idTipoDespesa` → dep 3 níveis | /despesas + /despesas/tipos + níveis |
| Despesas fixas vs variáveis | `classificacao`/`tipoCusto` | /despesas/tipos |
| Cartões: volume por bandeira/adquirente | Σ `valorBruto` | /vendascartoes |
| Taxa média efetiva de cartão | Σ taxas ÷ Σ bruto; por bandeira/parcelamento | /vendascartoes |
| Vendas cartão não conciliadas | transações sem baixa após N dias | /vendascartoes (status baixa) |
| Verbas a receber / recebidas | parcelas × pagamentos | /verbas + /verbas/pagas |

## 6. Compras

| Indicador | Cálculo | Fonte |
|---|---|---|
| Pedidos por situação | contagem/valor por `situacao` | /pedidoscompra |
| Lead time de atendimento | `dataAtendimento − dataPedido` (média/p90 por fornecedor) | /pedidoscompra |
| Pedidos pendentes antigos | pendente/parcial com idade > X | /pedidoscompra |
| Fill rate por fornecedor | `quantidadeAtendida ÷ quantidadePedida` | /pedidoscompra/produtos |
| Entradas do período (R$, volumes) | Σ notas de entrada | /entradas |
| Compras por comprador | valor por `idComprador` | /pedidoscompra + /compradores |

## 7. Metas (Previsão de Vendas)

| Indicador | Cálculo | Fonte |
|---|---|---|
| Meta mês × realizado (filial) | previsão vs Σ vendas | /previsaovendas + /filiais/vendas |
| Meta por departamento/marca/produto | recortes da previsão vs venda respectiva | /previsaovendas/* |
| Meta diária × realizado do dia | previsão diária | /previsaovendas/diaria + /vendas/hoje |
| Projeção de fechamento do mês | realizado ÷ dias úteis decorridos × `diasUteis` | idem |

## 8. Alertas (regras padrão; motor no doc 05 `app_alert_rules`)

| Alerta | Condição default | Severidade |
|---|---|---|
| Ruptura de item curva A | item A com estoque < mínimo | Alta |
| Estoque negativo | qualquer item < 0 (agrupado) | Média |
| Vencimento próximo | lote/produto vence em ≤7 dias | Alta (perecíveis) |
| Perda anormal | perda diária > média 30d + 2σ | Alta |
| Divergência de fechamento | `possuiDivergencia=true` ou fechamento não gerado até 10h | Alta |
| Queda de venda | hoje < 70% da média do mesmo dia-da-semana (4 sem.) até as 18h | Média |
| Meta em risco | ritmo projetado < 90% da meta no dia 15 | Média |
| Conta a vencer | parcelas a pagar vencendo em 3 dias (Σ > limiar) | Média |
| Cartão não conciliado | transações sem baixa há 7 dias | Média |
| Integração parada | sync falhando há 1 h / credencial inválida | Crítica |

Cada alerta: dedupe diário por chave, canais configuráveis, ack na UI, histórico.

## 9. Princípios de UX do dashboard (detalhe no doc 16)

- Padrão "5 segundos": a home responde "como está o dia?" sem interação.
- Sempre mostrar frescor do dado e distinguir tempo-real de consolidado.
- Drill-down consistente: total → filial → departamento → produto → cupom.
- Estados vazios explicativos (ex.: "aguardando primeiro fechamento sincronizado").
- Exportações CSV nos relatórios tabulares (permissão `reports.export`).

## 10. Estado da implementação (Fase 7)

| Spec | Implementação |
|---|---|
| §1 Visão executiva | `apps/api/src/modules/dashboard/home.service.ts` + `apps/web/src/app/page.tsx` |
| §2 Vendas — diário | `vendas.service.ts#doDia` + `apps/web/src/app/vendas/page.tsx` |
| §2 Vendas — comparativos | `vendas.service.ts#comparativo` + `apps/web/src/app/vendas/comparativos` |
| §4 Estoque (ruptura/negativo/excesso) | `estoque.service.ts` + `apps/web/src/app/estoque/page.tsx` |
| §9 Frescor e estados | `frescor.service.ts` + `components/dashboard.tsx` |
| §9 Export CSV | `dashboard.controller.ts#exportarDia` (permissão `reports.export`) |
| Cache do doc 14 §6 | `cache.service.ts` (60 s no dia corrente, 15 min no histórico) |

Decisões tomadas na implementação:

- **Uma chamada por tela, não por corte.** O doc 23 previa endpoints separados por recorte
  (`/kpi/sales/daily?groupBy=`); o que existe é um endpoint por tela, devolvendo os cortes que
  ela mostra. Motivo: cada tela vira uma ida ao servidor e uma chave de cache, em vez de cinco
  chamadas que precisariam ser reconciliadas no cliente.
- **Margem é de manager+, e o número some com explicação.** Papel sem acesso recebe `null` e a
  tela diz por quê. Esconder o cartão faria o usuário achar que o produto não calcula margem.
- **A comparação do dia é sempre com o mesmo dia da semana.** Sábado com sábado: comparar com
  "ontem" produziria queda de 40% toda segunda-feira, e o número viraria ruído.
- **Hoje é provisório e a tela diz isso.** O selo de frescor distingue tempo real de consolidado
  em todas as telas, como pede o §9 — é o que evita o suporte "o valor mudou sozinho".
- **O comparativo lê o resumo diário, não os cupons.** Uma linha por filial×dia responde o mesmo
  que somar dezenas de milhares de cupons, dentro do orçamento de 300 ms do doc 04 §3.1.
- **Custo da margem por departamento é o custo atual do cadastro.** A API não devolve o custo
  praticado na venda (doc 33); a limitação está escrita na própria tela, não só aqui.

Ainda não implementado deste doc: metas (§7) e margem por produto (§3) dependem da previsão de
vendas (E5-11); perdas, trocas, vencimentos e movimentações (§4) dependem de E5-10; financeiro
(§5) e compras (§6) dependem de E5-09/E5-10; vendedores e ofertas (§2) são P2. Os alertas (§8)
são a Fase 8.
