# 17 — Estratégia de Testes

## 1. Pirâmide e ferramentas

| Nível | Ferramentas | Escopo | Gate |
|---|---|---|---|
| Unit | Vitest/Jest | mappers SG (cada normalização do doc 12 §4), cálculos de KPI, regras de alerta, validadores | CI, cobertura ≥80% core |
| Integration | Jest + Testcontainers (pg, redis) | repositórios com RLS real, token manager, filas, upserts idempotentes | CI |
| Contract | Fixtures da coleção Postman + nightly contra homologação SG | schema de cada GET essencial; drift | CI (mock) + nightly (real) |
| API (nossa) | Supertest | contratos internos, RBAC, erros padronizados | CI |
| E2E | Playwright | fluxos críticos (login+MFA, onboarding conexão, home, alerta ack, admin usuários) | CI (smoke) + pré-release (full) |
| Security | ZAP baseline, testes dedicados abaixo | staging | pré-release |
| Performance | k6 | consultas de dashboard (p95<300 ms com 50 tenants sintéticos), sync burst | pré-release |
| Load/Stress | k6 | 200 usuários concorrentes; degradação graciosa (429 corretos) | trimestral |

Dados: **somente sintéticos** (factories geram tenants/vendas realistas com volumes da doc 02 §7);
proibido dado real de cliente em teste (doc 10).

## 2. Testes obrigatórios de segurança e isolamento

### Multi-tenant (gate absoluto — doc 08 §6)
- [ ] A→B em todos os endpoints internos (suite gerada do router): 404/vazio.
- [ ] SQL cru com `app.tenant_id=A` não lê/escreve linhas de B (RLS).
- [ ] Introspecção: nenhuma tabela com `tenant_id` sem política RLS.
- [ ] Chaves de cache sem prefixo de tenant → teste falha.
- [ ] Worker intercalando jobs A/B não vaza contexto.

### AuthN/AuthZ
- [ ] Matriz papel×permissão completa (tabela do doc 07 §3 vira parametrized test).
- [ ] Usuário sem permissão, token de sessão expirado, sessão revogada, MFA não concluído.
- [ ] Lockout após 5 falhas; rate limit de login (429).
- [ ] Proponente≠aprovador em ações ERP; MFA recente exigido.
- [ ] `filiais_allowed` respeitado em query param e em payloads.

### Integração SG
- [ ] Token expirado no meio de paginação → refresh transparente e retomada.
- [ ] 401 persistente → circuit breaker + status conexão error + alerta.
- [ ] Timeout/5xx → retry com backoff (GET) e **nenhum retry automático** em POST.
- [ ] Rota ausente de `routes_granted` → falha rápida com erro claro, sem chamada.
- [ ] Payload fora do schema → quarentena, página segue, métrica incrementa.
- [ ] Idempotência: sync do mesmo dia 2x → contagens idênticas no espelho.
- [ ] Janela >30 dias nunca é requisitada (guard de cliente).
- [ ] Anti-SSRF: base_url com IP privado/metadata/porta estranha → recusado.
- [ ] Redaction: logs de teste não contêm senha/token (assert no sink de log).

### Aplicação
- [ ] Injeção: SQLi (payloads em filtros), XSS armazenado via descrição de produto vinda do
  "ERP" (fixture maliciosa) renderizada com escape.
- [ ] CSRF em mutações sem token → 403.
- [ ] Headers de segurança presentes (teste de resposta).
- [ ] Erro 500 não vaza stack (corpo padronizado com correlation id).
- [ ] Export respeita máscara de CPF por papel.

## 3. Cenários funcionais críticos (aceite)

1. Fechamento detectado → dia consolidado substitui tempo-real sem duplicar (contas batem).
2. Venda cancelada aparece como cancelada e não soma nos KPIs.
3. Item com `idSubstituido` (pedido de venda) não conta duas vezes.
4. Meta: projeção correta em mês com feriado (diasUteis da API respeitado).
5. Alerta de ruptura: dedupe diário; ack silencia até nova ocorrência.
6. Backfill interrompido no meio retoma do watermark sem buracos (auditar contagens).
7. Tenant suspenso: login bloqueado, jobs pausados, dados intactos.
8. Offboarding: purge remove tudo do tenant (query de verificação zero linhas), auditoria de
   destruição preservada.

## 4. Regressão e qualidade contínua

- Snapshot de KPIs: dataset sintético canônico com valores esperados versionados — qualquer
  mudança de cálculo exige atualização consciente do snapshot (protege fórmulas de margem/ticket).
- Mutation testing (Stryker) nos módulos de cálculo — meta score ≥60% [RECOMENDAÇÃO].
- Flaky tests: quarentena com issue e prazo; CI não aceita retry silencioso.
