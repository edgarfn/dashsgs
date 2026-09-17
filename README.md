# DASHSGS — Plataforma SaaS Multi-tenant sobre a API SG Sistemas

Especificação completa de produto, arquitetura e desenvolvimento de um sistema SaaS multi-tenant
(dashboard analítico + portal operacional) construído sobre a **API SG - Terceiros** da SG Sistemas
(ERP de varejo/supermercados), documentada em https://api-doc.sgsistemas.com.br/.

**Status:** Fases 0–1 (Discovery/Arquitetura) concluídas; **Fases 2 (Foundation)**,
**3 (Autenticação)**, **4 (Multi-tenant/RLS)**, **5 (Integração com a API SG)** e
**6 (Sincronização)**, **7 (Dashboard MVP)**, **8 (Alertas & Financeiro)** e **9 (Security
Hardening)** implementadas — monorepo com CI, sessões
server-side com MFA, RBAC, isolamento por tenant provado no banco e na API, a camada
anti-corrupção que fala com o ERP (cofre de credencial, anti-SSRF, token manager, rate-limit,
circuit breaker), o motor de sincronização (watermarks, cadências em fila, consolidação
pós-fechamento, backfill resumível, agregados) e o dashboard: visão executiva com curva do dia,
diário de vendas cupom a cupom, comparativos e ruptura de estoque — com selo de frescor e export
CSV —, os painéis de financeiro (aging, fluxo previsto, despesas e taxas de cartão) e compras
(situação dos pedidos, lead time, pedidos parados), e os alertas que avisam o cliente sozinhos:
sete regras ativas, com feed, reconhecimento e e-mail. A Fase 9 fechou a CSP estrita (sem
`unsafe-inline`, verificada pelo navegador em todas as telas), a **retenção executável** — 21
políticas do doc 10 §2 que a rodada diária apaga e confere — o offboarding com purga física e
comprovante de destruição, e o **break-glass** com aprovação de segunda pessoa, prazo curto,
aviso ao dono do tenant e relatório do que foi acessado. A **Fase 10** deixou o produto
operável: a stack de observabilidade sobe como código (Prometheus, Alertmanager, Grafana com
cinco painéis provisionados, Loki, sonda externa e exporters), os seis SLIs do doc 18 §4 viraram
regras de gravação com burn rate e orçamento de erro, 35 alertas têm runbook obrigatório, e o
backup WAL-G faz arquivamento contínuo com um **teste de restauração semanal** que sobe um
cluster novo e confere migrações, contagens e a cadeia de auditoria. Depois dela, a **tela de Metas** fechou o
último P0 aberto do dashboard: a previsão de vendas do ERP passou a sincronizar (E5-11) e com ela
vieram o ritmo por filial, a projeção de fechamento e a oitava das dez regras de alerta do doc 15
§8. A **trilha de auditoria** ganhou tela
(`/admin/auditoria`), export CSV auditado e verificação da cadeia de hash na área de plataforma —
com isso não resta nenhum P0 aberto no repositório. Próxima: Fase 11 — beta fechado com 2–3
tenants reais. Nenhuma linha foi escrita antes
da especificação, por decisão de método: primeiro entender 100% da capacidade da API, depois
construir.

## Começando (dev)

```bash
pnpm install
cp .env.example .env          # já preenchido para dev; nenhum segredo real
pnpm infra:up                 # postgres + redis + mailpit (docker/compose.dev.yml)
pnpm db:migrate && pnpm db:seed
pnpm dev                      # api :3001 · web :3000 · mailpit :8025
# entre com owner@demo.local (o seed imprime a senha; o papel owner exige cadastrar MFA)
```

Para uma senha estável entre execuções, defina `SEED_PASSWORD` no `.env` — sem ela o seed sorteia
uma nova a cada vez (e a imprime). Rodar `pnpm db:seed` de novo é também o **reset** das contas
sintéticas: devolve a senha, desliga o MFA e encerra as sessões. É o caminho quando a tela pedir
um código de 6 dígitos de um autenticador que você nunca cadastrou — sinal de que a suíte E2E
cadastrou um, e o segredo dela morreu com o teste.

Se a máquina já tiver Postgres/Redis locais, defina `POSTGRES_PORT`/`REDIS_PORT` no `.env` e
ajuste as URLs. Verificação rápida: `curl localhost:3001/readyz` e `./scripts/smoke.sh`.
Detalhes, tutoriais e padrões de código no [24-development-guide.md](docs/24-development-guide.md).

| Comando                                                  | O que faz                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm dev`                                               | sobe API, web e o pacote compartilhado em watch              |
| `pnpm dev:worker`                                        | sobe o worker de sincronização (filas + cadências)           |
| `pnpm lint` · `pnpm format` · `pnpm typecheck`           | gates estáticos (mesmos do CI)                               |
| `pnpm test` · `pnpm test:cov`                            | testes unitários (+cobertura dos módulos transversais)       |
| `pnpm test:integration`                                  | testes com Postgres, Redis e Mailpit reais                   |
| `pnpm test:e2e`                                          | E2E no navegador (Playwright) com a aplicação de pé          |
| `pnpm test:contract`                                     | contrato contra a homologação SG (pula sem credenciais)      |
| `pnpm db:migrate` · `db:seed` · `db:drift` · `db:studio` | banco: migrar, semear, checar drift, inspecionar             |
| `pnpm db:rls-check`                                      | confere que toda tabela com `tenant_id` tem RLS              |
| `pnpm infra:up` · `infra:down` · `infra:reset`           | infraestrutura local                                         |
| `pnpm obs:check`                                         | gate: nenhuma regra/painel cita métrica que ninguém emite    |
| `pnpm obs:up`                                            | staging + stack de observabilidade (Grafana só em localhost) |
| `pnpm dr:backup` · `dr:restore-test`                     | backup sob demanda e restauração de conferência              |

## Estrutura do repositório

```
apps/api/          NestJS — API interna (BFF), health, métricas, plataforma transversal
apps/api/src/integration/sg/  camada anti-corrupção da API SG (token, HTTP, schemas, mocks)
apps/api/src/modules/sync/    sincronização: watermarks, jobs por domínio, filas, backfill
apps/web/          Next.js 15 — front (App Router, CSP com nonce)
packages/shared/   contratos compartilhados (códigos de erro, paginação, chaves de cache)
prisma/            schema, migrações (RLS e auditoria append-only) e seed sintético
docker/            compose de dev, compose de staging/prod, Dockerfiles, Caddyfile
docker/observability/  Prometheus (regras e SLIs), Alertmanager, painéis Grafana, Loki, sondas
docker/postgres/   imagem do banco com WAL-G embutido (arquivamento contínuo, doc 20)
scripts/           deploy por digest, smoke test, gates de drift/RLS/observabilidade
scripts/backup/    rodada de backup, teste de restauração e o agendador dos dois
docs/              a especificação (00–34) — fonte de verdade das decisões
```

## Convenções de marcação usadas em toda a documentação

| Marca                   | Significado                                                     |
| ----------------------- | --------------------------------------------------------------- |
| [DOCUMENTADO]           | Fato extraído da documentação oficial da API                    |
| [NECESSITA CONFIRMAÇÃO] | Informação ausente na documentação; confirmar com a SG Sistemas |
| [HIPÓTESE]              | Interpretação plausível, não confirmada                         |
| [RECOMENDAÇÃO]          | Decisão arquitetural nossa, não exigência da API                |

## Índice da documentação (`/docs`)

| Doc                                                                       | Conteúdo                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------- |
| [00-overview.md](docs/00-overview.md)                                     | Resumo executivo e visão do produto                 |
| [01-business-domain.md](docs/01-business-domain.md)                       | Domínio de negócio e glossário                      |
| [02-api-analysis.md](docs/02-api-analysis.md)                             | Análise técnica e crítica da API SG                 |
| [03-api-inventory.md](docs/03-api-inventory.md)                           | Inventário completo (105 endpoints, 41 módulos)     |
| [04-architecture.md](docs/04-architecture.md)                             | Arquitetura proposta + stack tecnológica            |
| [05-database.md](docs/05-database.md)                                     | Modelo de dados e ERD textual                       |
| [06-authentication.md](docs/06-authentication.md)                         | Autenticação (SaaS e credenciais ERP)               |
| [07-authorization.md](docs/07-authorization.md)                           | RBAC e matriz de permissões                         |
| [08-multi-tenancy.md](docs/08-multi-tenancy.md)                           | Estratégia multi-tenant e isolamento (RLS)          |
| [09-security.md](docs/09-security.md)                                     | Security by Design (OWASP ASVS/API Top 10)          |
| [10-privacy.md](docs/10-privacy.md)                                       | Privacy by Design (matriz de dados)                 |
| [11-devsecops.md](docs/11-devsecops.md)                                   | Pipeline e gates de segurança                       |
| [12-integrations.md](docs/12-integrations.md)                             | Especificação da integração com a API SG            |
| [13-webhooks.md](docs/13-webhooks.md)                                     | Eventos internos (a API SG não tem webhooks)        |
| [14-synchronization.md](docs/14-synchronization.md)                       | Estratégia de sincronização                         |
| [15-dashboard.md](docs/15-dashboard.md)                                   | Especificação do dashboard (KPIs com fonte/cálculo) |
| [16-ux-ui.md](docs/16-ux-ui.md)                                           | Estrutura de telas, menu e estados                  |
| [17-testing.md](docs/17-testing.md)                                       | Estratégia de testes                                |
| [18-observability.md](docs/18-observability.md)                           | Logs, métricas, traces, SLI/SLO                     |
| [19-deployment.md](docs/19-deployment.md)                                 | Implantação (dev/staging/prod)                      |
| [20-backup-disaster-recovery.md](docs/20-backup-disaster-recovery.md)     | Backup e DR                                         |
| [21-troubleshooting.md](docs/21-troubleshooting.md)                       | Diagnóstico de problemas                            |
| [22-runbooks.md](docs/22-runbooks.md)                                     | Procedimentos operacionais                          |
| [23-api-reference.md](docs/23-api-reference.md)                           | Referência da API interna (BFF)                     |
| [24-development-guide.md](docs/24-development-guide.md)                   | Manual de desenvolvimento + tutoriais               |
| [25-user-guide.md](docs/25-user-guide.md)                                 | Guia do usuário final                               |
| [26-admin-guide.md](docs/26-admin-guide.md)                               | Guia do administrador                               |
| [27-security-incident-response.md](docs/27-security-incident-response.md) | Resposta a incidentes                               |
| [28-lgpd.md](docs/28-lgpd.md)                                             | Conformidade LGPD (ROPA, bases legais, direitos)    |
| [29-roadmap.md](docs/29-roadmap.md)                                       | Roadmap em 15 fases                                 |
| [30-adrs.md](docs/30-adrs.md)                                             | Decisões arquiteturais (ADR-001..013)               |
| [31-backlog.md](docs/31-backlog.md)                                       | Backlog priorizado (épicos e histórias)             |
| [32-production-checklist.md](docs/32-production-checklist.md)             | Checklist de produção                               |
| [33-gap-analysis.md](docs/33-gap-analysis.md)                             | Gap analysis e riscos                               |
| [34-open-questions.md](docs/34-open-questions.md)                         | Perguntas pendentes de confirmação                  |

## Leitura recomendada por papel

- **Decisor/Product**: 00 → 15 → 29 → 33
- **Arquiteto/Dev**: 02 → 03 → 04 → 05 → 08 → 12 → 14 → 24
- **Segurança/DPO**: 09 → 10 → 28 → 27 → 32
- **Operação**: 19 → 20 → 21 → 22
