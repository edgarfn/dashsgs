# 29 — Roadmap

Ordem deliberada: fundação → segurança → dados → **só então** dashboard. Não se começa pelo
dashboard porque sem multi-tenancy/RLS, auth e sync corretos, o dashboard seria um protótipo a
reescrever. Estimativas em semanas para 1–2 devs experientes; fases 2–5 têm dependência linear,
depois há paralelismo possível.

| Fase | Objetivo | Entregas principais | Critérios de aceite | Riscos |
|---|---|---|---|---|
| **0 Discovery** ✅ | Entender API e domínio | Docs 00–03 (inventário 105 endpoints), riscos, perguntas à SG (doc 34) | Inventário completo; perguntas enviadas | Respostas da SG demorarem (não bloqueia fases 1–4) |
| **1 Arquitetura** ✅ | Decidir e especificar | Docs 04–16, ADRs, backlog | ADRs aprovados; backlog priorizado | — |
| **2 Foundation** ✅ | Esqueleto executável | Monorepo, CI com todos os gates (doc 11), compose dev, NestJS+Next “hello”, config zod, logger com redaction, error handler + correlation id, migração inicial | CI verde com SAST/SCA/secrets; `/readyz` ok; deploy staging automatizado | Overengineering — cortar o que não é gate |
| **3 Authentication** ✅ | Identidade sólida | Sessões, Argon2id, MFA TOTP, recuperação, lockout/rate-limit, convites, telas de auth, auditoria de authn | Testes doc 17 §AuthN passam; ZAP baseline sem High | — |
| **4 Multi-tenant** ← atual (2 sem) | Isolamento provado | Tenants, memberships, RBAC guard, RLS em template de migração, tenant-context (API+workers), suite A→B automatizada, cache prefixado | Suite de isolamento 100%; introspecção RLS no CI | RLS×Prisma exige SQL cuidadoso — spike previsto |
| **5 API Integration** (3 sem) | Falar com a SG com segurança | Cliente SG completo (token manager, rate-limit, breaker, mappers com allowlist), anti-SSRF, cofre de credencial, fixtures/mocks, testes de contrato, wizard de conexão + health | Conecta à homologação SG; contrato nightly verde; credencial cifrada; http recusado em prod | Confirmações pendentes da SG (formato header, RPS, TLS) — mitigação: flags configuráveis |
| **6 Core Sync** (3 sem) | Dados fluindo | Watermarks, scheduler, workers: dimensões, produtos incremental, vendas dia/hoje, resumo filial, finalizadoras; backfill resumível; consolidação pós-fechamento; painel sync-status | Backfill 90 d de tenant demo sem duplicar (idempotência testada); lag dentro do SLO em staging | Volumetria de /vendas (1 dia×filial) — paralelismo calibrado |
| **7 Dashboard MVP** (3 sem) | Valor visível | Home executiva, Vendas (diário/comparativos), Metas, Estoque-Ruptura/Vencimentos, exports CSV, estados vazios/erro, mobile da home | KPIs batem com dataset canônico (snapshot); p95<300 ms; LCP<2,5 s | Escopo de UI crescer — cortar por valor doc 15 |
| **8 Alertas & Financeiro** (3 sem) | Retenção do produto | Motor de regras + dedupe + e-mail; regras padrão doc 15 §8; telas Financeiro (aging, despesas, cartões) e Compras; sync respectivo | Alertas E2E ≤5 min; aging bate com ERP amostrado | Regra barulhenta → tuning com design partner |
| **9 Security Hardening** (2 sem) | Pronto p/ terceiros | Pentest externo + correções; headers/CSP final; break-glass; retenções/purge automatizados; DPA/política privacidade; checklist ASVS L2 crítico | Pentest sem High aberto; checklist doc 32 ≥ itens bloqueantes | Findings profundos → buffer |
| **10 Observability & SRE** (1–2 sem, paralelo 8–9) | Operável | Painéis Grafana, alertas operacionais, SLO board, backups WAL-G + restore test semanal automatizado, runbooks validados | Game-day parcial: restore + deploy + rollback executados | — |
| **11 Beta fechado** (4 sem corridas) | Validar com 2–3 tenants reais (design partners) | Onboarding real (VPN se preciso), feedback loop, tuning de cadências/alertas, hardening de volumetria | 3 tenants ativos 30 dias, NPS qualitativo, SLOs cumpridos | ERPs reais com particularidades (parametrizações) — quarentena ajuda |
| **12 Production/GA** (2 sem) | Comercial | Billing/planos, status page, docs usuário final, onboarding self-service parcial | Checklist produção 100% (doc 32) | — |
| **13 ERP Actions** (3 sem, pós-GA) | Escrita com governança | Módulo ações: ofertas, pedidos compra, acertos; workflow aprovação; execução auditada; DPIA gate | Testes de segregação; execução em homologação SG; rollback de proposta | Sem idempotência na API SG → verificação pré/pós execução obrigatória |
| **14 Melhoria contínua** | — | Módulo Clientes opt-in; webhooks de saída; benchmark opt-in (com parecer); múltiplas conexões por tenant; K8s se escala pedir | — | — |

## Marcos de valor
- **M1 (fim F7)**: primeiro tenant vê o dia em tempo real + histórico 90 d. *Vendável como beta.*
- **M2 (fim F8)**: alertas — o produto "liga sozinho" para o cliente. *Retenção.*
- **M3 (fim F12)**: GA. **M4 (fim F13)**: diferencial competitivo (ação, não só leitura).

## Regras de gestão do roadmap
1. Nenhuma fase pula os gates de teste da anterior (especialmente F4 — isolamento).
2. Mudança de escopo passa por atualização do backlog (doc 31) e desta página.
3. Perguntas da doc 34 revisitadas no início de cada fase — resposta nova pode simplificar
   (ex.: SG confirmar TLS elimina trilha VPN do MVP).
