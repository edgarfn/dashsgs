# 19 — Manual de Implantação

## 1. Ambientes

| Ambiente | Onde | Dados | Integração SG |
|---|---|---|---|
| development | Docker Compose local | sintéticos (seed) | mocks (fixtures) ou homologação SG |
| staging | VM dedicada (cópia de prod) | sintéticos | homologação SG (`sgps.sgsistemas.com.br:8201`) [DOCUMENTADO] |
| production | VM(s) dedicadas | reais | ERPs dos tenants (HTTPS/VPN) |

Mesma imagem promovida dev→staging→prod; diferenças só por variáveis (12-factor).

## 2. Topologia de produção (MVP)

```
Internet ──> [Cloudflare (opcional: WAF/CDN)] ──> VM app (Caddy :443)
   Caddy ──> web (Next.js, container)
         ──> api (NestJS, container)
   api/workers ──> postgres (container ou gerenciado*), redis (container)
   workers ──> ERPs dos tenants (egress allowlist)
   [obs] prometheus + loki + grafana (VM própria ou a mesma no MVP)
```
*[RECOMENDAÇÃO] Postgres gerenciado (RDS/Cloud SQL/Neon) assim que houver clientes pagantes —
backups/replicação sem custo operacional. Compose com volume + WAL-G é aceitável no MVP.

## 3. Variáveis de ambiente (contrato validado por zod no boot — falha rápida)

```
# App
NODE_ENV, APP_URL, API_URL, PORT
SESSION_SECRET (32B+), CSRF_SECRET, COOKIE_DOMAIN
# Banco/Cache
DATABASE_URL (TLS), DATABASE_URL_MIGRATOR, REDIS_URL
# Cripto
MASTER_KEY_CURRENT (base64 32B), MASTER_KEY_PREVIOUS (rotação), MASTER_KEY_VERSION
PII_PEPPER (hash de documentos)
# E-mail
SMTP_URL, MAIL_FROM
# Observabilidade
OTEL_EXPORTER_OTLP_ENDPOINT, SENTRY_DSN, LOG_LEVEL
# Integração
SG_DEFAULT_MAX_RPS=4, SG_HTTP_TIMEOUT_MS=60000, SG_HEAVY_TIMEOUT_MS=180000
# Flags
FEATURE_ERP_WRITE=false, FEATURE_CLIENT_MODULE=false
```
Segredos via SOPS/age (arquivos `.enc.env` no repo, chave fora) ou secret manager; nunca em
imagem/compose plano.

## 4. Procedimento de deploy (produção)

1. Release taggeada → CI publica imagem por digest + SBOM.
2. `deploy.sh <digest>`: pull → `docker compose up -d --no-deps api-migrate` (job de migração
   com `DATABASE_URL_MIGRATOR`) → healthcheck → swap dos serviços `api`/`web`/`workers` (rolling
   por replica) → smoke (`/readyz`, login sintético) → tag `current` atualizada.
3. Verificação pós-deploy 15 min (painel SLO); rollback: `deploy.sh <digest-anterior>`
   (migrações são expand/contract — compatíveis com N-1; doc 11 §3).
4. Janela: horário de baixo uso (13h–15h ou 22h+); nunca durante pico de manhã de sábado
   (varejo).

## 5. TLS e domínio

- Caddy com ACME automático; HSTS após validação; TLS 1.2+ apenas; OCSP stapling.
- `app.dashsgs.com.br` (web) e `api.dashsgs.com.br` (API) [exemplo]; cookies `__Host-`.

## 6. Migrations

- `prisma migrate deploy` somente via job de CI/CD (nunca dev na produção).
- Toda migração revisada em PR com plano de rollback; migrações destrutivas exigem release
  posterior (expand→contract).
- Backup automático imediatamente antes de migração (snapshot lógico rápido).

## 7. Provisionamento de tenant (produção)

1. Criar tenant + owner (convite) no painel platform-admin.
2. Owner cadastra conexão ERP (wizard) — exigências: HTTPS válido OU VPN provisionada
   (runbook 22 §7); teste automático; captura de rotas.
3. Backfill agendado (janela noturna); acompanhamento no painel.
4. Checklist de entrega: dashboards com 90 dias, alertas padrão ativos, usuários convidados.

## 8. Rollback e contingência

- App: redeploy do digest anterior (imutável).
- Banco: PITR (doc 20); migração ruim → restore + replay é último recurso, preferir fix-forward.
- Configuração: versionada em git; `git revert` + redeploy.
- Procedimento completo de DR no doc 20; runbooks no doc 22.
