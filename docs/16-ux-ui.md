# 16 — UX/UI: Estrutura do Sistema

## 1. Mapa de navegação (menu lateral)

```
◉ Visão Geral            (home executiva)
📈 Vendas                 (análise, comparativos, ofertas, vendedores)
💰 Margem & Custos
📦 Estoque & Perdas       (ruptura, cobertura, vencimentos, perdas, trocas, movimentações)
🏦 Financeiro             (a pagar, a receber, despesas, cartões, verbas)
🛒 Compras                (pedidos, fornecedores, entradas)
🎯 Metas                  (previsão × realizado)
🔔 Alertas                (feed, regras)
⚙ Administração          (usuários, papéis, conexão ERP, módulos, auditoria)  [por permissão]
```

Barra superior: seletor de tenant (se multi), seletor de filiais, período global, busca de
produto (id/descrição/GTIN), indicador de frescor/sync, menu do usuário (sessões, MFA, tema).

## 2. Inventário de telas

| Tela | Objetivo | Conteúdo principal | Ações | Permissão |
|---|---|---|---|---|
| Login / MFA / Recuperação | Autenticar | formulários mínimos | login, reset | pública |
| Onboarding do tenant | Configurar conexão ERP | wizard: dados conexão → teste → rotas detectadas → backfill com progresso | testar, salvar | owner/admin |
| Visão Geral | Status do negócio em 5 s | cards KPI (doc 15 §1), curva do dia, ranking filiais, alertas abertos, status fechamento | drill, ack alerta | dashboard.view |
| Vendas — Diário | Analisar um dia | tabela cupons (virtualizada), filtros caixa/cancelada/pedido, totais | export | dashboard.view |
| Vendas — Comparativos | Tendências | séries por filial/departamento; DoW; YoY | export | dashboard.view |
| Vendas — Ofertas | Efetividade de promoções | ofertas vigentes/histórico, uplift por oferta | export | dashboard.view |
| Vendas — Vendedores | Desempenho | ranking, comissões estimadas | export | manager+ |
| Margem | Margem por nível | árvore departamento→produto, semáforo | export | manager+ |
| Estoque — Ruptura | Repor o que vende | lista priorizada (curva A primeiro), cobertura, último fornecedor | export, criar proposta de pedido (fase 8) | dashboard.view |
| Estoque — Vencimentos | Evitar perda | produtos a vencer por faixa, por filial | export, criar proposta de oferta (fase 8) | dashboard.view |
| Perdas & Trocas | Controlar quebra | por motivo/produto/período; % da venda | export | dashboard.view |
| Movimentações | Investigação | extrato de movimentos por produto (23 tipos) | — | manager+ |
| Financeiro — A pagar/receber | Fluxo de caixa | aging, calendário de vencimentos, detalhe parcelas | export | manager+ |
| Financeiro — Despesas | Custo operacional | por tipo/departamento, fixas×variáveis | export | manager+ |
| Financeiro — Cartões | Taxas e conciliação | volume por bandeira/adquirente, taxa efetiva, não conciliadas | export | manager+ |
| Compras — Pedidos | Suprimento | lista por situação, lead time, fill rate | detalhe, proposta (fase 8) | dashboard.view |
| Metas | Acompanhamento | atingimento por filial/depto, projeção | — | dashboard.view |
| Alertas — Feed | Agir | lista com severidade, filtros, ack em massa | ack, ir ao contexto | alerts.ack |
| Alertas — Regras | Configurar | CRUD de regras com parâmetros e canais | criar/editar/desativar | alerts.manage |
| Admin — Usuários | Gestão de acesso | membros, papéis, filiais permitidas, convites | convidar, editar, remover | users.manage |
| Admin — Conexão ERP | Integração | status, base_url, teste, rotas contratadas, cadências, janela de sync | editar (MFA), re-testar, re-sync | erp_connection.manage |
| Admin — Módulos | Privacidade/escrita | toggles: módulo Clientes (com aviso LGPD/DPIA), Ações no ERP | habilitar (MFA) | modules.manage |
| Admin — Auditoria | Accountability | trilha filtrável (ator, ação, recurso, período), export | export | audit.view |
| Ações ERP — Propostas (fase 8) | Workflow de escrita | fila draft→aprovação→execução, diffs, resultado | propor, aprovar, cancelar | erp.propose/approve |
| Perfil | Autosserviço | senha, MFA, sessões ativas | revogar sessão | autenticado |

## 3. Estados obrigatórios por tela

| Estado | Padrão |
|---|---|
| Loading | Skeletons (nunca spinner de página inteira); dados em cache exibidos com badge "atualizando" |
| Vazio | Mensagem explicando o porquê + próxima ação ("Backfill em andamento — 62%", "Sem perdas no período 🎉") |
| Erro | Mensagem segura + correlation id + botão tentar de novo; erros de integração apontam para Admin→Conexão |
| Parcial | Se uma filial falhou no sync, banner "dados de filial X desatualizados desde HH:MM" |
| Sem permissão | 403 amigável sem vazar existência de dados |

## 4. Padrões de interação

- Filtros globais persistem por usuário (localStorage) e viram parâmetros de URL compartilháveis.
- Toda tabela: ordenação, paginação server-side, colunas configuráveis, export CSV (permissão).
- Drill-down por clique em qualquer barra/fatia; breadcrumb de contexto.
- Valores monetários em BRL, pt-BR; datas dd/mm; timezone do tenant.
- Dark mode; densidade compacta opcional (usuários de retaguarda gostam de densidade).

## 5. Acessibilidade e responsividade

- WCAG 2.1 AA: contraste, foco visível, navegação por teclado, aria em gráficos (tabela
  alternativa "ver dados"), sem informação só por cor (ícones + texto nos semáforos).
- Mobile-first para consulta: home, alertas e vendas de hoje perfeitos no celular (gestor de
  loja usa no chão de loja); telas analíticas densas otimizadas para desktop com fallback
  scrollável.
- Metas de performance: LCP < 2,5 s em 4G; bundle inicial < 250 kB gz; gráficos com
  virtualização/decimação para séries longas.
