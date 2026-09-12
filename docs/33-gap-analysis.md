# 33 — Gap Analysis, Riscos e Benchmark

## 1. O que a API oferece × o que o sistema precisa

| Necessidade do produto | API oferece? | Como cobrimos o gap |
|---|---|---|
| Vendas em tempo real | ✔ /vendas/hoje, /finalizadoras/hoje | Polling 5 min |
| Histórico consolidado com custos | ✔ /vendas, /filiais/vendas (5 custos) | Sync + espelho |
| Metas | ✔ /previsaovendas (+6 recortes) | — |
| Estoque/ruptura/validade | ✔ /produtos (+vencimentos, movimentações) | Snapshot diário p/ tendência (API só dá estado atual de estoque → **nós** historizamos) |
| Financeiro | ✔ contas/despesas/cartões/verbas | — |
| Compras | ✔ pedidos/entradas/distribuição | — |
| Notificação de mudanças (push) | ✘ sem webhooks | Polling incremental + janelas deslizantes |
| Deltas por timestamp | Parcial (só produtos tem dataAlteracao*) | Re-varredura periódica das demais entidades |
| Histórico de preço/estoque | ✘ (estado atual apenas) | Snapshots próprios no espelho |
| Idempotência de escrita | ✘ (sem Idempotency-Key) | `idPedidoIntegrador`/correlação + verificação pré/pós |
| Rate limit conhecido | ✘ não documentado | Self-throttling conservador |
| TLS documentado | ✘ (exemplos http) | Exigência HTTPS/VPN no onboarding |
| Sandbox self-service | Parcial (homologação com credencial da SG) | Mocks de fixtures p/ dev |
| Multi-empresa numa credencial | ✔ filiais na mesma instância | Multi-instância = multi-conexão (fase futura) |
| Identidade do consumidor p/ CRM | ✔ /clientes (rico demais) | Minimização deliberada; módulo opt-in |
| Margem por cupom exata | Parcial (custos por produto/dia, não por cupom) | Margem por produto-dia (aproximação documentada na UI) |
| Estorno/edição de pedidos via API | ✘ (só criação; cancelamento apenas de acertos) | Ações limitadas ao que existe; edição fica no ERP |

**Não é possível implementar via API** (dependeria da SG): push de eventos, relatórios fiscais
completos (SPED etc.), cadastro/edição de produtos, gestão de usuários do ERP, leitura de
parametrizações do ERP (ex.: se cliente usa lote em vencimentos — inferimos pelos dados).

## 2. Registro de riscos

| # | Risco | Prob. | Impacto | Sev. | Mitigação | Dono |
|---|---|---|---|---|---|---|
| R1 | Tráfego sem TLS até o ERP (doc mostra http) | Alta | Alto (credencial+PII em claro) | **Crítica** | HTTPS obrigatório ou VPN; recusa de http em prod; confirmação com SG | Arquitetura |
| R2 | Vazamento de credencial ERP de tenant | Média | Alto | **Crítica** | Cofre+cifra, redaction, rotação, monitor uso anômalo, IR doc 27 | Segurança |
| R3 | Bug de isolamento cross-tenant | Baixa | Altíssimo | **Crítica** | RLS FORCE + suite A→B como gate + pentest | Eng. |
| R4 | Sync agressivo degrada ERP do cliente (loja para) | Média | Alto | Alta | Self-rate-limit, janelas, breaker, monitor de duração | Eng. |
| R5 | Sem idempotência na API → escrita duplicada (pedido/oferta 2×) | Média | Alto | Alta | Zero retry automático em POST; verificação pré/pós; correlação idPedidoIntegrador | Eng. |
| R6 | Drift de contrato SG (sem OpenAPI/changelog) | Média | Médio | Alta | Contrato nightly + quarentena + alerta; contato SG | Eng. |
| R7 | Volumetria de backfill (2 anos×filiais) estoura janelas | Média | Médio | Média | Backfill progressivo, profundidade contratual, priorização 90 d | Eng. |
| R8 | Rotas contratadas variam por cliente (feature quebra) | Alta | Médio | Média | routes_granted → degradação graciosa + aviso comercial | Produto |
| R9 | Dependência de flags de fechamento p/ consolidação | Média | Médio | Média | Fallback por horário + alerta de fechamento atrasado | Eng. |
| R10 | LGPD: tenant ativa módulo Clientes sem governança | Média | Alto | Alta | Opt-in com DPIA gate + DPA + minimização estrutural | DPO |
| R11 | Equipe pequena vs. escopo (single point of failure humano) | Alta | Médio | Média | Documentação executável (este pacote), automação, escopo MVP disciplinado | Gestão |
| R12 | Homologação SG instável p/ testes nightly | Média | Baixo | Baixa | Mocks como fallback; nightly tolerante | Eng. |

## 3. Benchmark de mercado (padrões, sem cópia)

Referências públicas de categoria (BI varejo/soluções de dashboards para supermercados e
conciliadores): padrões que adotamos —
1. **Home "estado do negócio em 5 s"** com tempo real vs meta (padrão de apps de gestão de
   varejo).
2. **Alertas proativos** (ruptura/validade/quebra) como motor de retenção — categoria inteira
   converge nisso.
3. **Conciliação de cartões com taxa efetiva** — padrão de conciliadores (nossa API dá insumo
   nativo).
4. **Drill-down mercadológico** (departamento→produto) e curva ABC como linguagem do comprador.
5. **Onboarding assistido com teste de conexão e backfill visível** — reduz churn inicial.
6. **Selo de frescor de dados** — confiança é o produto; esconder defasagem destrói adoção.
7. Segurança como argumento comercial B2B: SSO/MFA, auditoria exportável, DPA padrão.

Diferencial nosso frente a BI genérico (Power BI/Metabase sobre extrações): tempo real do PDV,
alertas acionáveis, zero manutenção de ETL pelo cliente, e (fase 13) **fechar o ciclo agindo no
ERP** — nada disso um BI genérico entrega pronto.

## 4. Auditoria da própria análise (checklist doc 39 do prompt)

| Pergunta | Resposta |
|---|---|
| Todos os endpoints/módulos/schemas analisados? | Sim — 41 módulos, 105 endpoints inventariados mecanicamente (doc 03); exemplos de resposta de todos os recursos revisados |
| Webhooks? | Inexistentes na doc — confirmado por varredura |
| Autenticação coberta? | Sim (doc 02 §2) com 2 pendências: formato header, TLS |
| Limites identificados? | 30 dias, data única em /vendas, flags 3× tempo, token 1 h; RPS desconhecido (pendência) |
| Funcionalidades da API não utilizadas no MVP? | Escritas (fase 13), Clientes PII (opt-in), NFS/serviços (nicho), gôndolas (baixo valor imediato), observações de notas, rotas de entrega/pedidos de venda B2B (segmento delivery/atacado — fase futura) |
| Dados importantes fora do dashboard? | Tributações por produto (relatório fiscal futuro), séries de notas (uso operacional) |
| Riscos segurança/privacidade? | R1–R10 acima; controles docs 09/10 |
| Isolamento garantido? | Desenho RLS + testes como gate (docs 08/17) |
| Observabilidade/backup/DR/testes/documentação? | Docs 18/20/17 + este pacote |
| Novo dev roda só com a doc? | Doc 24 (setup→sync→verificação) foi escrito para isso |
| Suposições não marcadas? | Varremos: tudo incerto está em doc 34 / marcado [NECESSITA CONFIRMAÇÃO]/[HIPÓTESE] |
