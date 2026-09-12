# 04 — Arquitetura Proposta e Stack Tecnológica

## 1. Visão geral

Arquitetura de três planos, com o princípio: **o navegador nunca fala com a API SG** e **a API SG
nunca é exposta**; todo acesso passa pelo backend com credenciais no cofre.

```
                        USUÁRIO (browser)
                              │ HTTPS
                     ┌────────▼────────┐
                     │  WAF / Reverse  │  TLS, headers, rate limit de borda
                     │  Proxy (Caddy/  │
                     │  Nginx + CF)    │
                     └────────┬────────┘
                              │
                   ┌──────────▼──────────┐
                   │  FRONTEND (Next.js) │  SSR/SPA, sem segredos
                   └──────────┬──────────┘
                              │ HTTPS (API interna / BFF)
                   ┌──────────▼──────────┐
                   │   BACKEND (NestJS)  │  AuthN/AuthZ, RBAC, RLS ctx,
                   │   API REST + BFF    │  validação, auditoria
                   └───┬───────┬─────┬───┘
                       │       │     │
            ┌──────────▼─┐ ┌───▼───────────┐ ┌─────────▼─────────┐
            │ PostgreSQL │ │ Redis          │ │ Workers (BullMQ)  │
            │ (RLS por   │ │ cache + filas  │ │ sync, alertas,    │
            │  tenant)   │ │ + rate limiter │ │ agregações        │
            └────────────┘ └────────────────┘ └─────────┬─────────┘
                                                         │ HTTPS (exigido) / VPN
                                              ┌──────────▼──────────┐
                                              │ SG Integration Layer│  token manager por tenant,
                                              │ (anti-corruption)   │  retry/backoff, circuit breaker,
                                              └──────────┬──────────┘  self-rate-limit, mapeadores
                                                         │
                                             ERP SG do TENANT (on-prem/SG Cloud)
```

Observabilidade transversal: OpenTelemetry → Prometheus (métricas) + Loki (logs) + Grafana
(painéis/alertas) + Sentry (erros). Secrets: cofre (ver §4).

## 2. Componentes e responsabilidades

| Componente | Responsabilidade | Não faz |
|---|---|---|
| Frontend (Next.js) | UI, gráficos, sessão via cookie httpOnly | Nunca guarda token SG; nunca chama ERP |
| Backend API | Contrato REST interno (doc 23), RBAC, validação (zod/class-validator), auditoria, agregações sob demanda | Não chama ERP em request de usuário (exceção: ações de escrita aprovadas e health-check, sempre server-side) |
| Scheduler | Agenda jobs por tenant (cron + jitter) | — |
| Workers | Executam sync (doc 14), calculam agregados, avaliam regras de alerta, enviam notificações | — |
| SG Integration Layer | Cliente HTTP tipado da API SG; normalização (trim, tipos, envelopes); token manager; resiliência | Não contém regra de negócio do produto |
| PostgreSQL | Dados de app + espelho ERP + agregados + auditoria; RLS | — |
| Redis | Cache de leitura, locks distribuídos, filas BullMQ, rate limiting | Fonte de verdade |
| Object Storage (S3-compat; fase 2) | Exportações (CSV/PDF), backups | — |

**API Gateway dedicado**: [RECOMENDAÇÃO] *não* usar na fase inicial — um gateway (Kong etc.) só
adiciona complexidade com um único backend; o reverse proxy + middleware do NestJS cobrem TLS,
rate limit e headers. Reavaliar quando houver múltiplos serviços.

## 3. Fluxos principais

### 3.1 Leitura de dashboard (caminho quente)
Browser → Backend → PostgreSQL (agregados prontos) — alvo p95 < 300 ms. Redis cacheia consultas
repetidas com chave **prefixada por tenant** (doc 14 §cache). Nenhuma chamada ao ERP no caminho
do request.

### 3.2 Sincronização (caminho frio)
Scheduler enfileira `sync:<tenant>:<domínio>` → worker adquire lock por tenant+domínio → token
manager entrega JWT válido → chamadas paginadas com self-rate-limit → normalização → upsert
idempotente → atualização de watermark → recalcula agregados → avalia alertas.

### 3.3 Ação de escrita no ERP (fase 8+, feature-flag por tenant)
Usuário cria proposta (ex.: oferta) → aprovador confirma (4-eyes, permissão dedicada) → job
executa POST na API SG com `idPedidoIntegrador`/registro de correlação → resultado auditado
(payload enviado, resposta, ator, aprovação) → estado refletido na UI.

## 4. Stack tecnológica (com justificativa e alternativa)

| Camada | Escolha | Motivo | Alternativa | Trade-off |
|---|---|---|---|---|
| Linguagem | TypeScript (Node 22 LTS) | Um idioma no front e back; tipagem do contrato anticorrupção; ecossistema de filas/ORM maduro | Go no backend | Go ganha em footprint; perde em velocidade de entrega e reuso de tipos com o front |
| Backend | NestJS 11 | Módulos, DI, guards/interceptors (RBAC, tenant-context, audit) prontos; testabilidade | Fastify puro | Menos estrutura ⇒ mais disciplina manual |
| Frontend | Next.js 15 + React | SSR p/ TTFB do dashboard, App Router, ecossistema | Vite+SPA | SPA simplifica deploy, perde SSR |
| UI | Tailwind + shadcn/ui + ECharts | Produtividade; ECharts lida bem com séries longas e drill-down | Recharts | Recharts mais simples, menos denso |
| Banco | PostgreSQL 17 | RLS nativa (isolamento multi-tenant), window functions p/ KPIs, particionamento de fatos | MySQL | Sem RLS equivalente — descartado (ADR-002) |
| ORM | Prisma (app) + SQL nativo p/ agregações | Migrações versionadas, tipos gerados | Drizzle | Drizzle mais leve; Prisma tem melhor DX de migração |
| Filas/Jobs | BullMQ (Redis) | Retry/backoff/prioridade/locks nativos, repeatable jobs | RabbitMQ | Mais operação; desnecessário no volume atual |
| Cache | Redis 7 | Cache + locks + rate limit no mesmo serviço | Memcached | Sem estruturas p/ locks/filas |
| AuthN app | Sessão server-side (cookie httpOnly SameSite=Lax) + Argon2id + TOTP | Revogação imediata, sem JWT no browser (ADR-004) | JWT access+refresh | JWT complica logout/revogação |
| Secrets | SOPS+age (fase 1) → Vault/Cloud KMS (fase 2); credenciais ERP cifradas com AES-256-GCM via envelope (chave mestra fora do banco) | Custo/benefício progressivo | Vault desde o início | Operação pesada p/ equipe pequena |
| Observabilidade | OpenTelemetry SDK + Prometheus + Grafana + Loki + Sentry | Padrão aberto, self-host barato | Datadog | Custo |
| CI/CD | GitHub Actions | Integração com repo; gates (doc 11) | GitLab CI | Equivalente |
| Contêineres | Docker + Compose (prod fase 1) | Simplicidade; 1 VM forte atende MVP | Kubernetes | Adotar somente com necessidade real de escala (ADR-013) |
| Proxy/TLS | Caddy | TLS automático, config mínima | Nginx | Nginx mais conhecido, mais verboso |
| E-mail/notificação | SMTP transacional (Resend/SES) + webhooks Slack/WhatsApp fase 2 | Alertas são núcleo do valor | — | — |

## 5. Estrutura de repositório (monorepo)

```
dashsgs/
├── apps/
│   ├── web/                     # Next.js
│   │   └── src/{app,components,features,lib}
│   └── api/                     # NestJS
│       └── src/
│           ├── modules/
│           │   ├── auth/        # sessões, MFA, recuperação
│           │   ├── tenants/     # tenants, conexões ERP, filiais
│           │   ├── users/       # usuários, memberships, RBAC
│           │   ├── dashboard/   # endpoints de KPIs/consultas
│           │   ├── alerts/      # regras, avaliação, notificações
│           │   ├── erp-actions/ # escritas no ERP (fase 8)
│           │   └── audit/       # trilha de auditoria
│           ├── integration/sg/  # anti-corruption layer
│           │   ├── client/      # http, token-manager, rate-limit, circuit-breaker
│           │   ├── mappers/     # normalização por recurso
│           │   └── types/       # tipos do contrato SG (gerados da coleção)
│           ├── sync/            # jobs, watermarks, backfill
│           ├── common/          # guards, interceptors, filters, tenant-context
│           └── config/          # env schema (zod), constantes
├── packages/
│   ├── shared/                  # tipos e validadores compartilhados
│   └── ui/                      # componentes compartilhados (se necessário)
├── prisma/                      # schema, migrações, seeds
├── docker/                      # compose, Dockerfiles, Caddyfile
├── docs/                        # esta documentação
└── .github/workflows/           # CI/CD
```

## 6. Decisões antecipadas (detalhe em 30-adrs.md)

- ADR-001 Monolito modular (não microserviços) no MVP.
- ADR-002 PostgreSQL com RLS; fatos particionados por tenant+mês.
- ADR-003 Shared database / shared schema + RLS (doc 08).
- ADR-004 Sessão server-side no app; JWT SG confinado ao backend.
- ADR-006 Sincronização pull incremental com watermarks; sem chamadas ERP no request path.
- ADR-013 Docker Compose em produção no MVP; K8s adiado.

## 7. Requisitos não-funcionais alvo

| Atributo | Alvo MVP |
|---|---|
| Disponibilidade | 99,5% mensal (dashboard); sync tolera indisponibilidade do ERP |
| Latência dashboard | p95 < 300 ms (consultas agregadas) |
| Frescor tempo real | vendas de hoje ≤ 5 min de defasagem (configurável por tenant) |
| Frescor dia fechado | até 60 min após fechamento detectado |
| RPO / RTO | 1 h / 4 h (doc 20) |
| Tenants suportados (MVP) | 50 tenants × 20 filiais sem re-arquitetura |
