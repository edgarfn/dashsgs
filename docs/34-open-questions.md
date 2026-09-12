# 34 — Perguntas que Precisam de Confirmação

Destinatário principal: SG Sistemas (contato@sgsistemas.com.br) e/ou tenant piloto.
Nenhuma resposta bloqueia as fases 2–4 do roadmap; Q1–Q4 bloqueiam a fase 5 em produção.

## Para a SG Sistemas (técnico)

| # | Pergunta | Por que importa | Bloqueia |
|---|---|---|---|
| Q1 | A API do cliente pode ser exposta via **HTTPS** (certificado próprio/SG Cloud)? Qual a prática recomendada de transporte em produção? | R1 (crítico): sem TLS não colocamos credencial/PII na rede | F5 prod |
| Q2 | Formato canônico do header `Authorization`: JWT puro ou `Bearer <jwt>`? Ambos aceitos? | Implementação do token manager | F5 |
| Q3 | Existe **rate limit**/limite de conexões? Qual RPS é seguro sem afetar o ERP da loja? | Calibrar self-throttling (R4) | F5 prod |
| Q4 | `itensPorPagina` máximo aceito por endpoint? | Custo de backfill | F6 |
| Q5 | No **SG Cloud**, o prefixo `/public` vale só para `/autorizacao` ou para todas as rotas? | Cliente HTTP correto p/ tenants cloud | F5 (tenants cloud) |
| Q6 | POSTs são idempotentes de alguma forma? `idPedidoIntegrador` duplicado é rejeitado ou duplica pedido? | Estratégia de reprocesso seguro (R5) | F13 |
| Q7 | Existe changelog/aviso de mudanças da API? Versionamento além de `/v1`? | Gestão de drift (R6) | — |
| Q8 | Há endpoints/eventos push não publicados (webhooks)? | Simplificaria tempo real | — |
| Q9 | `GET /sgsistemas/v1/status` exige token? | Health-check sem consumir login | — |
| Q10 | Token: existe revogação server-side ao trocar a senha do usuário de integração? | Janela de exposição em incidente | — |
| Q11 | Podem emitir **usuário somente-leitura** (subconjunto de rotas GET) por padrão? | Least privilege contratual | F5 |
| Q12 | Timezone dos campos `horario`/`expire_time`: sempre o fuso do servidor da loja? | Correção de séries por hora | F6 |
| Q13 | `/vendas/hoje` após o fechamento: retorna vazio, erro ou dados parciais? | Semântica do realtime | F6 |
| Q14 | Período máx. de 30 dias vale também para /produtos/vendas, /perdas, /contas/*? (documentado só p/ movimentações, trocas e /filiais/vendas) | Janelas de sync | F6 |
| Q15 | Encoding garantido UTF-8? Campos texto podem vir em CP850/Latin1 de bases antigas (ERP Harbour)? | Normalização de acentuação | F6 |
| Q16 | Homologação: dados são resetados? Podemos usá-la p/ testes nightly contínuos? | Contrato nightly (doc 12 §7) | — |

## Para o tenant piloto (negócio/infra)

| # | Pergunta | Por que importa |
|---|---|---|
| T1 | O ERP é on-premise ou SG Cloud? Há IP fixo/possibilidade de VPN? | Modo de transporte |
| T2 | Quantas filiais, produtos ativos e cupons/dia? | Dimensionar backfill/cadências |
| T3 | Horário de fechamento diário habitual e responsável? | Orquestração da consolidação |
| T4 | Quais rotas o contrato SG de vocês libera hoje? (rodar /autorizacao e ler `routes`) | Escopo real de features |
| T5 | Profundidade de histórico desejada (12/26 meses)? | Custo de backfill |
| T6 | Precisam de dados de clientes identificados (CRM/crediário)? Existe base legal mapeada? | Gate do módulo Clientes (DPIA) |
| T7 | Janela noturna aceitável p/ sync pesado? | Configuração inicial |

## Decisões internas pendentes (não dependem da SG)

| # | Decisão | Prazo |
|---|---|---|
| D1 | Provedor de hospedagem/região (Brasil) e Postgres gerenciado | antes F9 |
| D2 | Nome/domínio definitivo do produto | antes F12 |
| D3 | Designar DPO e jurídico p/ DPA/política | antes F11 |
| D4 | Política comercial de planos (filiais? usuários? módulos?) | antes F12 |
