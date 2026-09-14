# 08 — Especificação Multi-tenant

## 1. Definições

- **Tenant** = um contrato DashSGS = uma empresa/rede que usa o ERP SG (1 conexão ERP no MVP;
  N conexões por tenant é evolução prevista — redes com múltiplas instâncias do ERP).
- **Organização = tenant** (sem hierarquia de organizações no MVP).
- **Usuário** pertence a 1..N tenants via **membership** (papel + filiais permitidas).
- **Recursos** de dados sempre carregam `tenant_id`; recursos derivados do ERP carregam também
  a chave natural do ERP (ids sequenciais **por instância** — nunca globais).

## 2. Estratégia de isolamento — decisão

Avaliação das três opções:

| Estratégia | Prós | Contras | Veredito |
|---|---|---|---|
| Shared DB / shared schema + RLS | Operação simples, migração única, custo baixo, agregações cross-tenant p/ telemetria interna | Exige disciplina de RLS; blast radius lógico | **ESCOLHIDA (MVP)** |
| Shared DB / schema por tenant | Isolamento físico parcial | Migrações ×N, connection pool fragmentado, ferramentas piores | Não |
| DB por tenant | Isolamento máximo, restore individual | Custo e operação ×N; overkill p/ 50 tenants | Migração futura para tenants enterprise (o design com `tenant_id` em tudo permite extração limpa) |

Justificativa: volume MVP (≤50 tenants) não paga o custo operacional de isolamento físico;
PostgreSQL RLS fornece isolamento lógico forte **com enforcement no banco**, não só na aplicação
(defense in depth). ADR-003.

## 3. Implementação RLS (PostgreSQL)

```sql
-- Papel da aplicação SEM bypass:
CREATE ROLE app_rw LOGIN NOSUPERUSER NOBYPASSRLS;

-- Em cada tabela com tenant_id:
ALTER TABLE erp_venda_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_venda_itens FORCE ROW LEVEL SECURITY;   -- vale até p/ o dono da tabela
CREATE POLICY tenant_isolation ON erp_venda_itens
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

- A aplicação abre transação e executa `SET LOCAL app.tenant_id = '<uuid>'` (interceptor NestJS
  lê o tenant da sessão — **jamais** de parâmetro do cliente).
- `SET LOCAL` garante escopo por transação (seguro com pool).
- Jobs de sync fazem o mesmo por tenant processado.
- Tabelas globais (`app_users`, `app_tenants`, `app_sessions`) ficam fora de RLS mas com acesso
  apenas via serviços dedicados.
- Migrations rodam com papel separado (`app_migrator`), também sem BYPASSRLS onde possível.
- Funções `SECURITY DEFINER`: proibidas salvo revisão de segurança explícita; quando usadas,
  `SET search_path` fixo e validação de `app.tenant_id`.

### Por que RLS além do WHERE da aplicação
Um único repositório esquecendo o filtro não pode virar vazamento cross-tenant. O banco é a
última linha; a aplicação continua filtrando (índices e clareza), mas não é confiada sozinha.

## 4. Isolamento nas demais camadas

| Camada | Regra |
|---|---|
| Cache Redis | Chave prefixada `t:<tenant_id>:...`; proibido cachear resposta sem prefixo; flush por prefixo no offboarding |
| Filas | Payload carrega tenant_id; worker seta contexto antes de tocar o banco; locks `lock:t:<id>:...` |
| Logs/traces | `tenant_id` como label; nunca dados de outro tenant no mesmo evento |
| Storage (exports) | Path `tenants/<id>/...` + URL assinada de curta duração |
| Credenciais ERP | Uma por tenant, cifrada; token SG cacheado por tenant |
| Erros | Mensagens nunca citam existência de recursos de outro tenant (404 uniforme) |
| Métricas de produto | Agregadas por tenant_id apenas em plano interno (telemetria), sem PII |

## 5. Ciclo de vida do tenant

| Fase | Ações |
|---|---|
| Provisionamento | Criar tenant, owner por convite, cadastrar conexão ERP, health-check, sync inicial (backfill) |
| Suspensão | Bloqueia login de membros e pausa jobs; dados mantidos |
| Offboarding | Exportação sob demanda → exclusão lógica → job de purge físico (30 dias) → flush cache → registro de destruição (LGPD art. 16) |

## 5.1 Estado da implementação (Fase 4)

| Spec | Implementação |
|---|---|
| `SET LOCAL app.tenant_id` por transação | `apps/api/src/common/prisma/prisma.service.ts` (`withTenant`) |
| Porta única de acesso a dado de tenant | `apps/api/src/common/tenant/tenant-database.service.ts` |
| Templates de RLS | `prisma/migrations/*_init` (`app_enable_tenant_rls`, `app_enable_identity_rls`) |
| Gate de introspecção | `app_rls_gaps()` + `pnpm db:rls-check` (job de integração do CI) |
| Recorte por filial | `apps/api/src/common/tenant/filiais-scope.service.ts` |
| Suíte A→B gerada do router | `apps/api/test/integration/isolation.int-spec.ts` |
| Suspensão/reativação | `apps/api/src/modules/platform/platform.service.ts` |

Dois templates, e não um, porque o fluxo de identidade lê `app_memberships` e `app_sessions`
**antes** de existir tenant escolhido. O template estrito (dados de tenant) levanta erro sem
contexto; o de identidade permite a leitura quando não há contexto e isola quando há.

## 5.2 Offboarding com purga física (Fase 9 — E6-04)

O ciclo do §5 agora é executável de ponta a ponta:

| Passo | Onde |
|---|---|
| Exclusão lógica (pede o slug digitado) | `POST /platform/tenants/:id/offboard` · `/plataforma` |
| Carência de 30 dias | `offboarding.service.ts` — quem está dentro dela não aparece como pendente |
| Purga física | rodada diária das 3h20, ou botão em `/plataforma/retencao` |
| Flush de cache | `redis.purgeTenant()`, na mesma transação lógica |
| Registro de destruição (LGPD art. 16) | evento `tenant.purged` na trilha, com linhas por tabela |

Três decisões que valem explicação:

- **A lista de tabelas vem da introspecção**, não de uma lista escrita à mão: toda tabela com
  `tenant_id` entra, inclusive as que ainda não existem. Lista à mão envelhece, e o modo de
  falhar dela é silencioso — o dado de um cliente desligado sobrevive numa tabela que alguém
  criou depois.
- **A ordem de exclusão se resolve sozinha**: tenta todas as tabelas, repete as que falharam por
  referência. Cada rodada apaga ao menos uma folha, então converge — e continua correto quando
  surgir uma relação nova.
- **Duas coisas não são apagadas**: `app_audit_log` (é a prova da destruição, e tem retenção
  própria de 5 anos) e o registro do tenant, que fica como lápide com `purged_at` — sem ele, as
  linhas da auditoria apontariam para um id inexistente.

Conta de usuário que fica sem nenhum vínculo é marcada como excluída na purga; a remoção física
dela vem seis meses depois, pela política `usuarios_desligados` (doc 10 §2).

Ainda não implementado deste doc: múltiplas conexões por tenant e extração de tenant enterprise
para banco próprio.

## 6. Testes de isolamento obrigatórios (gate de release — doc 17)

1. **API**: para cada endpoint interno, requisição autenticada do tenant A com ids do tenant B →
   404/lista vazia; suite automatizada gerada a partir do catálogo de rotas.
2. **Banco**: teste de integração que, com `app.tenant_id = A`, tenta `SELECT/UPDATE/DELETE` em
   linhas de B → 0 linhas afetadas, mesmo com SQL cru (bypass do ORM).
3. **RLS ligada**: teste que falha se alguma tabela com coluna `tenant_id` estiver sem política
   RLS (introspecção de catálogo `pg_policies` no CI).
4. **Cache**: teste que assegura prefixo de tenant em toda chave (lint + teste de integração).
5. **Jobs**: worker processando fila com jobs de A e B intercalados não mistura contexto
   (teste de corrida com asserts de contagem por tenant).
