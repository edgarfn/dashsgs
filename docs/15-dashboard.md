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
| Projeção de fechamento do mês | realizado ÷ fração do mês decorrida | idem |

**Implementado em 17/09/2026 (E5-11 + E7-03).** Duas notas sobre a projeção, porque a fórmula
mudou em relação ao que estava escrito acima:

- **A fração decorrida sai da curva diária quando o ERP a fornece**, e não de "dias úteis
  decorridos". Contar dias úteis exigiria conhecer o calendário de feriados da loja; a curva que
  o gerente lançou já o conhece. Sem curva, a conta cai na proporcional (dias corridos), e a tela
  **diz qual das duas está em uso** — projeção sem procedência é número que ninguém sabe se pode
  usar.
- **O destaque da tela é o ritmo, não o atingimento.** No dia 10, ter 30% da meta não informa
  nada sozinho; o que informa é onde o mês fecha mantido o passo. As filiais aparecem ordenadas
  da pior para a melhor.

Os recortes por departamento, marca e produto (linha 2 da tabela) continuam fora: dependem de
`/previsaovendas/departamentos/*`, que só valem a pena junto com a margem por produto (§3).

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

Ainda não implementado deste doc: margem por produto (§3); perdas, trocas, vencimentos e
movimentações (§4) dependem do resto de E5-10; vendedores e ofertas (§2) são P2. As metas (§7)
entraram em 17/09/2026 com a previsão de vendas (E5-11).

## 11. Estado da implementação dos alertas (Fase 8)

| Regra do §8 | Situação |
|---|---|
| Ruptura de item curva A | ✅ avaliada a cada 5 min |
| Estoque negativo | ✅ |
| Divergência de fechamento | ✅ (divergência do ERP **ou** venda diária não gerada até a hora limite) |
| Queda de venda | ✅ (comparação com o mesmo dia da semana, 4 semanas) |
| Integração parada | ✅ (conexão em erro ou sync atrasado) |
| Conta a vencer | ✅ soma as parcelas que vencem na janela e avisa uma vez por dia |
| Cartão não conciliado | ✅ por filial, transações sem baixa além do prazo |
| Vencimento próximo · Perda anormal | ⛔ dependem da sincronização de vencimentos e perdas (E5-10) |
| Meta em risco | ✅ a partir do dia configurado (padrão 15), quando a projeção fica abaixo de 90% da meta |

As regras indisponíveis **existem** no catálogo e aparecem na tela desligadas, com a dependência
escrita. Some da tela seria pior: o cliente concluiria que o produto não cobre aquilo.

Decisões tomadas na implementação:

- **Um alerta por problema por filial, não por item.** "37 itens de curva A em ruptura na Loja
  Centro" é uma frase que alguém age; 37 e-mails com um item cada é o que faz o cliente criar
  regra no Outlook para mandar tudo à lixeira.
- **Dedupe diário por chave** (§8): a chave carrega o dia e o escopo. O mesmo problema no mesmo
  dia é o mesmo alerta; no dia seguinte ele volta, porque continua doendo.
- **Reconhecer ≠ resolver.** O botão marca que alguém assumiu, e o alerta sai da lista de abertos.
  Numa rede com vários gerentes olhando o mesmo feed, é o que evita dois resolverem a mesma coisa.
- **O motor roda fora do caminho do sync.** O alerta mais importante é "a integração parou" — ele
  precisa disparar justamente quando o sync não está funcionando, então não pode depender dele.
- **Queda de venda só depois da hora de corte.** Às 9h toda loja está abaixo da média do dia; um
  alerta que dispara todo dia cedo é um alerta que ninguém lê.

## 12. Estado da implementação do financeiro e de compras (Fase 8)

| Spec | Implementação |
|---|---|
| §5 Aging a pagar/receber | `dashboard/financeiro.service.ts` (faixas em SQL sobre a parcela) |
| §5 Fluxo previsto (13 semanas) | idem, `DATE_TRUNC('week')` sobre o que está em aberto |
| §5 Despesas por tipo, fixas × variáveis | idem + `erp_tipos_despesa` |
| §5 Cartões: volume, taxa efetiva, não conciliados | idem (`erp_cartao_vendas`) |
| §6 Pedidos por situação, lead time, pendentes antigos | `dashboard/compras.service.ts` |
| §6 Entradas do período | idem (`erp_notas_entrada`) |

Decisões tomadas na implementação:

- **O aging é de parcela, não de título.** Um título com três parcelas pode ter uma vencida e duas
  a vencer; somar pelo título esconderia exatamente o que a tela existe para mostrar.
- **A taxa de cartão é média ponderada pelo volume.** A média simples daria o mesmo peso a uma
  transação de R$ 5 e a uma de R$ 5.000 — e é assim que se conclui que a taxa é o dobro do que é.
- **Lead time do pedido ao atendimento**, não à previsão: a previsão é promessa do fornecedor, e o
  que o comprador precisa saber é quanto ela costuma valer.
- **A janela do sync financeiro olha para trás e para frente** (45 dias / 90 dias): o aging precisa
  do que vai vencer, e a reconciliação precisa do título que foi baixado depois de emitido.
- **O painel financeiro é de manager+.** Venda todo mundo vê; dívida, custo fixo e taxa de cartão
  são material de gestão (doc 02, classificação FINANCIAL).
- **Fill rate por fornecedor (§6) ficou de fora**: depende de `/pedidoscompra/produtos`, que só
  entra quando houver tela de detalhe do pedido.

Nomes de campo dos endpoints financeiros: a coleção não traz exemplo de resposta de todos eles, e
os schemas foram escritos a partir do doc 03/05. O **contrato noturno** cobre os cinco recursos e é
quem confirma ou desmente contra a homologação — item [NECESSITA CONFIRMAÇÃO] até a primeira
execução com credencial.
