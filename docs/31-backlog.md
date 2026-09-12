# 31 — Backlog Priorizado

Prioridades: P0 obrigatório MVP · P1 importante · P2 recomendado · P3 futuro.
Complexidade: P/M/G. Cada item herda o DoD do doc 24 §9. Critérios de aceite resumidos (CA).

## Épico E1 — Foundation (Fase 2) — **concluído**
| ID | História | Pri | Cx | Depende | CA |
|---|---|---|---|---|---|
| E1-01 ✅ | Monorepo pnpm + apps api/web + packages/shared | P0 | M | — | build+dev funcionam |
| E1-02 ✅ | CI completo com gates (lint, test, SAST, SCA, secrets, build, Trivy) | P0 | M | E1-01 | PR bloqueia conforme doc 11 §2 |
| E1-03 ✅ | Compose dev (pg, redis, mailpit) + seeds sintéticos | P0 | P | E1-01 | `pnpm dev` sobe tudo |
| E1-04 ✅ | Config por env com schema zod (falha rápida) | P0 | P | E1-01 | boot falha com env inválida |
| E1-05 ✅ | Logger estruturado + redaction + correlation id middleware | P0 | M | E1-01 | teste de redaction passa |
| E1-06 ✅ | Error handler global padronizado | P0 | P | E1-05 | corpo {code,message,correlationId,timestamp} |
| E1-07 ✅ | Deploy staging por digest + smoke | P0 | M | E1-02 | pipeline até staging |

### O que a Fase 2 deixou pronto

- **E1-01** — monorepo pnpm (apps/api, apps/web, packages/shared); build e dev verdes
- **E1-02** — .github/workflows/ci.yml: lint, typecheck, cobertura, Semgrep, osv-scanner+audit, gitleaks, build, integração com pg/redis, Trivy
- **E1-03** — docker/compose.dev.yml (pg 17, redis 7, mailpit) + prisma/seed.ts sintético
- **E1-04** — apps/api/src/config/env.schema.ts (zod, guardas de produção) — testado
- **E1-05** — nestjs-pino + redaction por nome de campo + correlação via AsyncLocalStorage
- **E1-06** — AllExceptionsFilter — corpo {code,message,correlationId,timestamp}, sem stack
- **E1-07** — deploy-staging.yml (imagem por digest + SBOM) + scripts/deploy.sh e smoke.sh

Decisões tomadas durante a implementação (não estavam na spec):

- `app_memberships`, `app_sessions` e `app_audit_log` usam o template `app_enable_identity_rls`:
  isolam por tenant quando há contexto e permitem leitura no fluxo de login, que acontece antes
  de existir um tenant escolhido. Dados de tenant (`erp_`/`agg_`/`sync_`) usarão
  `app_enable_tenant_rls`, que **falha** sem `app.tenant_id` definido — a Fase 4 aplica isso
  tabela a tabela (E3-02).
- `filiais_allowed` é array não-nulo com **vazio = todas as filiais** (o Prisma não modela array
  anulável, e ter dois jeitos de dizer "sem restrição" no banco seria pior).
- O modo `standalone` do Next é ligado por `NEXT_OUTPUT_STANDALONE=true` (Dockerfile), porque ele
  cria symlinks e quebraria `pnpm build` na máquina Windows de quem desenvolve.
- Cobertura unitária é medida sobre os módulos transversais (config, logging, errors,
  correlation, validation); serviços com I/O são cobertos pela suíte de integração. A régua de
  80% do doc 11 §2 acompanha a chegada de cada módulo core.

## Épico E2 — Autenticação (Fase 3)
| ID | História | Pri | Cx | Depende | CA |
|---|---|---|---|---|---|
| E2-01 | Modelo users/sessions + Argon2id + login/logout | P0 | M | E1 | testes authn |
| E2-02 | Rate limit login + lockout incremental | P0 | P | E2-01 | 429/lock testados |
| E2-03 | Recuperação e troca de senha (tokens single-use) | P0 | P | E2-01 | invalidação de sessões |
| E2-04 | MFA TOTP + códigos de recuperação | P0 | M | E2-01 | obrigatório p/ admin |
| E2-05 | Convites por e-mail (fluxo tenant) | P0 | M | E2-01, E3-01 | expira, single-use |
| E2-06 | Telas: login, MFA, reset, perfil, sessões ativas | P0 | M | E2-01..04 | E2E Playwright |
| E2-07 | Auditoria de eventos de autenticação | P0 | P | E2-01, E6-01 | eventos gravados |

## Épico E3 — Multi-tenant & RBAC (Fase 4)
| ID | História | Pri | Cx | Depende | CA |
|---|---|---|---|---|---|
| E3-01 | Modelo tenants/memberships/papéis + guard RBAC | P0 | M | E2 | matriz doc 07 testada |
| E3-02 | RLS: template de migração + políticas + papéis de DB | P0 | G | E1 | introspecção no CI |
| E3-03 | Tenant-context (interceptor API + wrapper workers) | P0 | M | E3-02 | SET LOCAL comprovado |
| E3-04 | Suite de isolamento A→B gerada do router | P0 | M | E3-01..03 | 100% endpoints cobertos |
| E3-05 | Cache prefixado por tenant (helper + lint) | P0 | P | E3-03 | teste de prefixo |
| E3-06 | `filiais_allowed` fim-a-fim | P1 | M | E3-01 | testes de filial |
| E3-07 | Painel platform-admin básico (criar tenant/suspender) | P0 | M | E3-01 | runbook 22 §1/2 executável |

## Épico E4 — Integração SG (Fase 5)
| ID | História | Pri | Cx | Depende | CA |
|---|---|---|---|---|---|
| E4-01 | Tipos + fixtures da coleção (todas as respostas doc 03) | P0 | M | — | zod schemas por recurso |
| E4-02 | Token manager (cache, lock, renovação, rotas) | P0 | M | E4-01 | testes de expiração/401 |
| E4-03 | Cofre de credencial (AES-GCM envelope + write-only UI) | P0 | M | E3 | DBA não lê; rewrap testado |
| E4-04 | Cliente HTTP: timeout/retry/backoff/rate-limit/breaker | P0 | G | E4-02 | políticas doc 12 §3 testadas |
| E4-05 | Mappers com allowlist + normalizações doc 12 §4 + quarentena | P0 | G | E4-01 | fixtures maliciosas tratadas |
| E4-06 | Anti-SSRF na configuração de base_url | P0 | P | E4-03 | payloads bloqueados |
| E4-07 | Wizard de conexão + health + rotas detectadas | P0 | M | E4-02..06 | conecta homologação SG |
| E4-08 | Testes de contrato nightly (homologação) | P1 | M | E4-07 | job agendado + alerta drift |
| E4-09 | Suporte VPN (tls_mode=vpn) — provisão manual documentada | P1 | M | E4-07 | runbook 22 §7 |

## Épico E5 — Sincronização (Fase 6)
| ID | História | Pri | Cx | Depende | CA |
|---|---|---|---|---|---|
| E5-01 | Watermarks + scheduler + locks por (tenant,domínio) | P0 | M | E4 | sem execução dupla |
| E5-02 | Sync dimensões (todas as leves) | P0 | M | E5-01 | upsert idempotente |
| E5-03 | Sync produtos incremental (3 datas) + satélites (precos/ofertas/gtins) | P0 | G | E5-02 | watermark por tipo |
| E5-04 | Sync vendas hoje + finalizadoras hoje (5 min) | P0 | M | E5-02 | lag ≤10 min |
| E5-05 | Sync dia fechado + consolidação transacional (substitui realtime) | P0 | G | E5-04 | contagens batem; sem duplicar |
| E5-06 | Sync resumo diário /filiais/vendas + flags | P0 | M | E5-01 | 30d respeitado |
| E5-07 | Backfill resumível com progresso + janelas noturnas | P0 | G | E5-02..06 | 90 d sem gaps |
| E5-08 | Agregados (agg_*) recalculados por evento | P0 | M | E5-05 | consistentes com fatos |
| E5-09 | Sync financeiro (contas, despesas, cartões) | P1 | G | E5-01 | reconciliação semanal |
| E5-10 | Sync compras (pedidos, entradas) + perdas/trocas/vencimentos/movimentações | P1 | G | E5-01 | janelas ≤30 d |
| E5-11 | Sync previsão de vendas (+recortes) | P1 | M | E5-01 | mês corrente+próximo |
| E5-12 | Painel sync-status por tenant | P0 | M | E5-01 | lag/erros visíveis |

## Épico E6 — Plataforma transversal
| ID | História | Pri | Cx | CA |
|---|---|---|---|---|
| E6-01 | Auditoria append-only + hash chain + UI consulta | P0 | M | tamper test |
| E6-02 | Métricas Prometheus + painéis Grafana + alertas doc 18 | P0 | M | SLO board |
| E6-03 | Backups WAL-G + restore test semanal automatizado | P0 | M | doc 20 §3 |
| E6-04 | Jobs de retenção/purga (partições, logs, offboarding) | P0 | M | verify-purge zero |
| E6-05 | dashsgs-cli (tenant, sync, queue, crypto, breakglass) | P1 | M | runbooks executáveis |
| E6-06 | Export CSV assíncrono com máscara por papel | P1 | M | limite/permite testados |

## Épico E7 — Dashboard MVP (Fase 7)
| ID | História | Pri | Cx | Depende | CA |
|---|---|---|---|---|---|
| E7-01 | Home executiva (cards + curva do dia + ranking + fechamento) | P0 | G | E5-04..08 | snapshot KPIs |
| E7-02 | Vendas diário (cupons) + comparativos | P0 | G | E5-05 | p95<300ms |
| E7-03 | Metas (previsão×realizado + projeção) | P0 | M | E5-11 | cálculo diasUteis |
| E7-04 | Estoque: ruptura + vencimentos + cobertura | P0 | M | E5-03/10 | curva A priorizada |
| E7-05 | Estados vazios/erro/parcial + selo de frescor | P0 | M | — | doc 16 §3 |
| E7-06 | Mobile da home + acessibilidade AA | P1 | M | E7-01 | Lighthouse/axe |
| E7-07 | Margem por nível (dep→produto) | P1 | G | E5-05 | custo configurável |
| E7-08 | Financeiro (aging, despesas, cartões) + Compras | P1 | G | E5-09/10 | amostras batem |
| E7-09 | Vendas por vendedor / ofertas | P2 | M | E5-05 | — |

## Épico E8 — Alertas (Fase 8)
| ID | História | Pri | Cx | CA |
|---|---|---|---|---|
| E8-01 | Motor de regras + dedupe + eventos | P0 | G | E2E ≤5 min |
| E8-02 | Canais e-mail + feed com ack | P0 | M | template acessível |
| E8-03 | Regras padrão doc 15 §8 (seed por tenant) | P0 | M | disparos testados |
| E8-04 | UI de configuração de regras | P1 | M | validação params |
| E8-05 | Alerta de integração (credencial/lag) p/ admin do tenant | P0 | P | — |

## Épico E9 — Hardening/GA (Fases 9–12)
E9-01 Pentest + correções (P0/G) · E9-02 CSP final sem unsafe-inline (P0/M) · E9-03 Break-glass
auditado (P1/M) · E9-04 DPA/política/DPO (P0/M, jurídico) · E9-05 Billing/planos (P0/G) ·
E9-06 Status page (P1/P) · E9-07 Game-day DR (P0/M).

## Épico E10 — Ações no ERP (Fase 13, P2 no MVP)
E10-01 Framework de propostas/aprovação (G) · E10-02 Oferta (M) · E10-03 Pedido de compra (G) ·
E10-04 Acertos de estoque (M) · E10-05 Baixa/correção cartões (G) · E10-06 GTINs (P) ·
E10-07 Verificação pré/pós execução (sem idempotência na API) (M).

## Épico E11 — Futuro (P3)
Módulo Clientes opt-in completo · Webhooks de saída · Multi-conexão por tenant ·
Benchmark anônimo entre tenants (parecer jurídico) · App notificações push · ClickHouse p/
histórico longo · K8s.
