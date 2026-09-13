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
3. Testar conexão → conferir rotas detectadas → rodar `pnpm sync:run --domain dimensoes`
   *(a partir da Fase 6; hoje o teste de conexão já valida credencial, rotas e versão do ERP)*.
4. Alternativa offline: `SG_MOCK=true` responde pelas fixtures em
   `apps/api/src/integration/sg/mock/fixtures.ts`, que reproduzem os defeitos documentados da API
   (padding, data vazia, decimal com vírgula, envelopes de página diferentes). Usuário/senha que
   o mock aceita: `homologacao` / `homologacao-senha-de-teste`.
5. Contrato contra a homologação de verdade: `SG_HOMOLOG_BASE_URL=... SG_HOMOLOG_USER=...
   SG_HOMOLOG_PASSWORD=... pnpm test:contract`. Sem as variáveis a suíte é pulada com aviso — é o
   mesmo comando que o job noturno do CI executa.
6. ERP só em HTTP (sem TLS): não se cadastra pela internet. Provisione o túnel WireGuard e marque
   VPN no wizard — runbook 22 §7; a faixa aceita é `SG_VPN_CIDR`.

## 4. Tutorial — criar o primeiro tenant e usuário (fluxo real)
1. `pnpm cli tenant create --name "Rede Exemplo" --slug rede-exemplo --owner-email dono@ex.com`
2. Abrir link de convite (Mailpit) → definir senha (+MFA se owner).
3. Wizard de conexão → backfill → dashboards.

## 5. Tutorial — primeira sincronização e verificação

A sincronização roda no **processo de worker**, não na API:

```bash
pnpm dev:worker          # ou, a partir do build: node apps/api/dist/worker.js
```

Com ele de pé e a conexão testada, as cadências começam sozinhas (doc 14 §2). Pela tela,
Administração → **Sincronização** mostra o frescor por domínio e por filial, permite
"Sincronizar agora" e dispara a carga de histórico.

```bash
curl localhost:3002/metrics | grep sync_       # frescor, execuções e profundidade das filas
curl localhost:3002/healthz                    # o worker responde aqui, não na porta da API
```

A conferência dos números é por SQL enquanto o dashboard não existe (Fase 7):

```sql
-- dentro de uma transação com SET LOCAL app.tenant_id = '<uuid>'
SELECT data, SUM(valor_total) FROM erp_vendas_cupons WHERE cancelada = false GROUP BY data;
SELECT * FROM sync_watermarks ORDER BY domain;
```

*(`pnpm cli sync ...` chega com E6-05; até lá, o painel e o SQL acima cobrem o mesmo terreno.)*

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
3. Tabela espelho + migração (chave natural com tenant_id) + `CALL app_enable_tenant_rls('erp_x')`
   na própria migração — sem isso o gate `pnpm db:rls-check` reprova o PR.
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
| Tabela de tenant sem RLS | `app_rls_gaps()` + `pnpm db:rls-check` (gate do CI) |
| Endpoint novo sem teste de isolamento | suíte A→B gerada do router (`isolation.int-spec.ts`) |
| Query de tenant sem contexto | `TenantDatabase` é a única porta; a RLS estrita recusa o resto |

`@typescript-eslint/consistent-type-imports` fica **desligado** em `apps/api/src`: o NestJS injeta
dependências pelos metadados de decorator, e trocar esses imports por `import type` faria a
injeção receber `undefined` em runtime.

## 7.2 Onde ficam os testes (estado atual)

| Suíte | Comando | O que cobre |
|---|---|---|
| Unitária | `pnpm test` | lógica pura: contrato de env, redaction, erros, permissões, cifra, política de senha, cadeia de hash |
| Integração | `pnpm test:integration` | API real contra Postgres, Redis e Mailpit: login, MFA, convites, senha, auditoria |
| E2E | `pnpm test:e2e` | navegador contra a aplicação de pé (Next → API): login+MFA, recuperação, perfil, cabeçalhos, wizard de conexão ERP |
| Contrato | `pnpm test:contract` | respostas reais da homologação SG contra nossos schemas (nightly; pula sem credenciais) |

A suíte de integração cobre a sincronização executando os jobs **direto** (sem fila): é o que
permite afirmar, em segundos, que repetir um dia não duplica linha. A fila em si é exercitada
pelo teste do endpoint (que enfileira e confere que nada rodou no request) e pelo worker real em
desenvolvimento.

O E2E pressupõe a aplicação rodando e o banco semeado com senha conhecida:

```bash
pnpm infra:up && pnpm db:migrate
SEED_PASSWORD="Senha-Demo-Muito-Longa-2026" pnpm db:seed
pnpm build && pnpm --filter @dashsgs/web start &   # :3000
SG_MOCK=true node apps/api/dist/main.js &           # :3001 (fixtures no lugar do ERP)
pnpm test:e2e
```

Os testes zeram contadores de rate limit e o estado de MFA das contas do seed antes de cada
cenário — sem isso um cenário herdaria a sessão (12 h) e o segundo fator do anterior.

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
