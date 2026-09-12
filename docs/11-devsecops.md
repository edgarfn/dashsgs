# 11 — Plano DevSecOps

## 1. Pipeline (GitHub Actions)

```
Developer
  │  pre-commit: lint-staged + gitleaks protect + typecheck rápido
  ▼
Git (PR → main)          [branch protection: 1 review, checks verdes, sem force-push]
  ▼
CI (por PR)
  1. Install (lockfile congelado: npm ci)
  2. Lint (eslint + prettier check)          ── falha = bloqueia
  3. Typecheck (tsc --noEmit)                ── bloqueia
  4. Unit tests + coverage (≥80% módulos core: auth, tenant, sync, mappers) ── bloqueia
  5. SAST (Semgrep: p/ ts, nodejs, jwt, sqli, ssrf rulesets)                ── bloqueia em HIGH
  6. SCA (osv-scanner + npm audit --omit dev)                               ── bloqueia CRITICAL/HIGH com fix disponível
  7. Secret scan (gitleaks detect – repo completo)                          ── bloqueia sempre
  8. Build (apps/web, apps/api) + prisma validate/migrate diff              ── bloqueia
  9. Container build + Trivy image scan                                     ── bloqueia CRITICAL
 10. Integration tests (docker compose: pg+redis; RLS suite; contract mocks)── bloqueia
  ▼
Merge → build de artefato imutável (imagem taggeada por digest + SBOM syft)
  ▼
Deploy STAGING (auto) → smoke tests → DAST (ZAP baseline authenticated) ── gate manual se findings
  ▼
Deploy PRODUCTION (aprovação manual 1 pessoa ≠ autor) → smoke + health checks → monitoramento
  ▼
Pós-deploy: verificação de migrações, error-rate 15 min, rollback automático se SLO burn
```

## 2. Gates de segurança (política)

| Gate | Regra de bloqueio | Exceção |
|---|---|---|
| Secrets | Qualquer segredo detectado | Nenhuma — revogar e reescrever histórico |
| SAST | HIGH/CRITICAL | Waiver documentado com prazo (issue vinculada), aprovado por 2ª pessoa |
| SCA | CRITICAL sempre; HIGH com patch disponível | Waiver com prazo ≤30 dias |
| Container | CRITICAL no OS/base | Trocar base; waiver ≤14 dias |
| Cobertura | <80% nos módulos core | Não mergeia |
| RLS suite | Qualquer falha de isolamento | Nenhuma |
| DAST | Alertas High | Corrigir antes de produção |

## 3. Práticas

- **Trunk-based** com branches curtas; feature flags para trabalho incompleto (nunca código morto
  de segurança desligada).
- **IaC**: compose/Caddyfile/cloud-init versionados; mudanças de infra via PR.
- **SBOM** (syft) publicado por release; verificação de proveniência (provenance attestation)
  [RECOMENDAÇÃO fase 2].
- **Renovate** semanal com auto-merge de patch em dev-deps; prod-deps sempre com review.
- **Migrations**: expand → migrate → contract (compatível com rollback); proibido `DROP` no mesmo
  release que remove o uso.
- **Ambientes**: dev (local compose) / staging (réplica com dados sintéticos + homologação SG) /
  produção. Mesma imagem promovida entre ambientes; só muda configuração (12-factor).
- **Acesso à produção**: apenas via bastion, MFA, sessões gravadas em auditoria de infraestrutura;
  sem psql manual fora de break-glass com ticket.
- **Homologação SG no CI**: testes de contrato agendados (nightly) contra
  `sgps.sgsistemas.com.br:8201` com credenciais de homologação em secret do CI — detecta drift da
  API (doc 12 §7). Nunca rodar testes contra ERP de cliente.

## 4. Segurança do próprio pipeline

- OIDC para deploy (sem chaves longas em secrets quando possível).
- Actions pinadas por SHA; `permissions:` mínimos por workflow; sem `pull_request_target` com
  checkout de código de fork.
- Runners: GitHub-hosted p/ CI; deploy runner self-hosted isolado com acesso restrito.
- Secrets do CI segregados por ambiente; produção só no environment protegido.
