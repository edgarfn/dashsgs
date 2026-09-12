# 24 — Manual de Desenvolvimento (+ Tutoriais)

## 1. Pré-requisitos
Node 22 LTS, pnpm 9, Docker Desktop, Git. Windows: usar WSL2 para paridade com produção
[RECOMENDAÇÃO].

## 2. Tutorial — instalação local do zero
```bash
git clone <repo> dashsgs && cd dashsgs
pnpm install
cp .env.example .env           # já preenchido p/ dev (sem segredos reais)
pnpm infra:up                  # postgres + redis + mailpit (docker/compose.dev.yml)
pnpm db:migrate && pnpm db:seed                  # schema + tenant demo com dados sintéticos
pnpm dev                                         # api :3001, web :3000, workers
```
Login demo: `owner@demo.local` / senha do seed (impressa no console). Mailpit em :8025 captura
e-mails (convites/reset).

Notas de ambiente (Fase 2):
- `pnpm infra:up` passa `--env-file .env` de propósito: é dali que vêm `POSTGRES_PORT`,
  `REDIS_PORT` e `MAILPIT_*`. Máquina com Postgres local ocupando a 5432? Defina
  `POSTGRES_PORT=55432` no `.env` e ajuste `DATABASE_URL`/`DATABASE_URL_MIGRATOR`/
  `SHADOW_DATABASE_URL` — nenhuma outra mudança é necessária.
- Em dev/teste a API carrega o `.env` da raiz sozinha (o processo continua falhando rápido se o
  contrato não fechar). Em produção o arquivo é ignorado: configuração vem do ambiente.
- Verificação rápida do esqueleto: `curl localhost:3001/readyz` (deve trazer `postgres`, `redis`
  e `migrations` em `ok`) e `./scripts/smoke.sh http://localhost:3001`.

## 3. Tutorial — configurar integração com homologação SG
1. Obter credenciais de homologação com a SG (contato@sgsistemas.com.br) [DOCUMENTADO: ambiente
   `sgps.sgsistemas.com.br:8201`, usuário `homologacao`].
2. No app (tenant demo) → Admin→Conexão ERP: base_url `http://sgps.sgsistemas.com.br:8201`
   *(dev aceita http apenas com `ALLOW_INSECURE_ERP=true`; produção nunca)*.
3. Testar conexão → conferir rotas detectadas → rodar `pnpm sync:run --domain dimensoes`.
4. Alternativa offline: `SG_MOCK=true` usa fixtures da coleção Postman (pasta
   `apps/api/test/fixtures/sg`).

## 4. Tutorial — criar o primeiro tenant e usuário (fluxo real)
1. `pnpm cli tenant create --name "Rede Exemplo" --slug rede-exemplo --owner-email dono@ex.com`
2. Abrir link de convite (Mailpit) → definir senha (+MFA se owner).
3. Wizard de conexão → backfill → dashboards.

## 5. Tutorial — primeira sincronização e verificação
```bash
pnpm cli sync backfill --tenant rede-exemplo --depth 90d
pnpm cli sync status --tenant rede-exemplo         # watermarks e lag
# validar contagens:
pnpm cli sync verify --tenant rede-exemplo --domain vendas --date 2026-09-01
```

## 6. Padrões de código
- TypeScript `strict`; ESLint + Prettier (config única no repo); imports absolutos por alias.
- Commits: Conventional Commits; PR pequeno (<400 linhas de diff líquido) com descrição do porquê.
- Camadas: controller (validação/permissão) → service (regra) → repository (SQL/Prisma).
  Integração SG só é chamada por services de sync/ações — nunca por controllers de leitura.
- Proibições (lint custom onde possível): `SELECT *` em respostas, query sem tenant context,
  `console.log` (usar logger), acesso a `process.env` fora de `config/`, chamada HTTP fora do
  cliente da integração.
- Dinheiro: `Decimal`/centavos, nunca float. Datas: `date-fns-tz`, timezone do tenant.
- Todo endpoint novo nasce com: DTO validado, permissão declarada, teste de contrato, teste A→B
  de tenant, entrada no OpenAPI interno.

## 7. Como adicionar um novo domínio de sync (passo-a-passo)
1. Tipar resposta SG em `integration/sg/types` (a partir da doc 03 + fixture real de homologação).
2. Mapper com allowlist de campos (decisão de privacidade registrada no PR — doc 10).
3. Tabela espelho + migração (chave natural com tenant_id; RLS automática via template).
4. Job em `sync/` com watermark e cadência; registrar no scheduler.
5. Fixture + testes (unit mapper, integração upsert idempotente, contrato).
6. Expor no BFF (se for a dashboards) + cache com invalidação por evento.
7. Atualizar docs 03/14/15.

## 7.1 Onde as regras do §6 são cobradas (implementado na Fase 2)

| Regra | Onde é aplicada |
|---|---|
| `console.log` proibido | `eslint.config.mjs` → `no-console` (exceto seeds/scripts) |
| `process.env` só em `config/` | `no-restricted-syntax` com override para `config/`, `integration/` e scripts |
| `SELECT *` proibido | `no-restricted-syntax` sobre literais e templates |
| Cliente HTTP fora da integração | `no-restricted-imports` (axios/node-fetch/undici) |
| Segredo/PII fora do log | `common/logging/redaction.ts` + teste `test/unit/redaction.spec.ts` |
| Erro padronizado | `common/errors/all-exceptions.filter.ts` + testes de contrato |
| Schema × migrações em sincronia | `pnpm db:drift` (gate do CI) |
| Segredo no repositório | `gitleaks` no pre-commit e no CI (`.gitleaks.toml`) |

`@typescript-eslint/consistent-type-imports` fica **desligado** em `apps/api/src`: o NestJS injeta
dependências pelos metadados de decorator, e trocar esses imports por `import type` faria a
injeção receber `undefined` em runtime.

## 8. Debug
- API: `pnpm dev:api --inspect`; VS Code launch configs no repo.
- Um request: header `X-Debug-Trace: 1` em dev liga log verbose para aquele correlation id.
- Sync: `pnpm cli sync run ... --dry-run` mostra chamadas e diffs sem gravar.
- Banco: `pnpm db:studio` (Prisma Studio) — apenas dev.

## 9. Definição de Pronto (DoD — vale para toda história)
[ ] Implementado conforme spec · [ ] Testes unit+integração (e A→B se endpoint) ·
[ ] Permissões declaradas e testadas · [ ] Multi-tenant verificado · [ ] Sem segredo/PII em log ·
[ ] Erros padronizados · [ ] Métricas/log de evento se job · [ ] Docs atualizados ·
[ ] Migração com rollback plan · [ ] Revisado por 1 pessoa
