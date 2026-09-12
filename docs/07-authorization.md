# 07 — Autorização (RBAC)

## 1. Modelo

RBAC com escopo de tenant + restrição opcional por filial. ABAC pontual (atributo `filiais_allowed`
na membership). Avaliação **sempre server-side**, em guard central do NestJS; o frontend apenas
esconde o que o backend já nega.

```
user ──< membership (tenant, role, filiais_allowed[]) >── tenant
platform_admin: papel global fora de membership (equipe DashSGS), contas separadas
```

## 2. Papéis

| Papel | Descrição | Uso típico |
|---|---|---|
| `platform_admin` | Operação da plataforma; gerencia tenants; **não lê dados de negócio dos tenants por padrão** (acesso break-glass auditado) | Equipe DashSGS |
| `owner` | Dono do tenant; tudo do admin + billing + excluir tenant | Dono da rede |
| `admin` | Gerencia usuários/papéis, conexão ERP, regras de alerta, habilita módulos (clientes/escrita) | TI do cliente |
| `manager` | Todos os dashboards e relatórios; cria propostas de ação no ERP; **aprova** ações se tiver a permissão extra `erp.approve` | Gerente de loja/comercial |
| `analyst` | Dashboards e relatórios; exportações | Analista |
| `viewer` | Somente visualização de dashboards | Encarregado |
| `auditor` | Somente leitura de trilha de auditoria + dashboards; não altera nada | Auditoria/contabilidade |

## 3. Permissões (catálogo)

Formato `recurso.ação`. Papéis mapeiam para conjuntos de permissões (tabela estática versionada
em código, não editável por usuário no MVP — simplicidade e previsibilidade).

| Permissão | owner | admin | manager | analyst | viewer | auditor |
|---|---|---|---|---|---|---|
| dashboard.view | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| reports.export | ✔ | ✔ | ✔ | ✔ | — | — |
| alerts.manage | ✔ | ✔ | ✔ | — | — | — |
| alerts.ack | ✔ | ✔ | ✔ | ✔ | — | — |
| users.manage | ✔ | ✔ | — | — | — | — |
| erp_connection.manage | ✔ | ✔ | — | — | — | — |
| modules.manage (habilitar clientes/escrita) | ✔ | ✔ | — | — | — | — |
| erp.propose (criar proposta de escrita) | ✔ | ✔ | ✔ | — | — | — |
| erp.approve (aprovar execução) | ✔ | ✔ | opcional* | — | — | — |
| audit.view | ✔ | ✔ | — | — | — | ✔ |
| billing.manage | ✔ | — | — | — | — | — |

*`erp.approve` para manager é concedida por flag na membership; **quem propõe não aprova a
própria proposta** (segregação de funções imposta no serviço).

## 4. Regras duras (enforcement)

1. Toda query de dados passa pelo tenant-context (RLS) — doc 08. RBAC decide *o que*; RLS garante
   *de quem*.
2. `filiais_allowed`: filtro adicional aplicado no repositório **e** verificado no guard para
   parâmetros de filial explícitos (ex.: `?filial=3` com allowed=[1,2] → 403).
3. Ações de escrita no ERP: exigem módulo habilitado no tenant + `erp.propose`/`erp.approve` +
   MFA recente (≤15 min) + registro em `app_erp_action_requests` — sem caminho direto UI→ERP.
4. Trilha: toda decisão de negação relevante gera evento `authz.denied` na auditoria.
5. `platform_admin` acessando dados de tenant: modo break-glass — exige justificativa, gera
   auditoria destacada e notificação ao owner do tenant.

## 4.1 Estado da implementação (Fase 3)

A matriz do §3 vive em `packages/shared/src/authz.ts` (compartilhada com o front, que a usa só
para esconder o que o backend já nega) e é cobrada pelo `PermissionsGuard`
(`apps/api/src/modules/auth/guards/permissions.guard.ts`), global e com negação auditada.
O teste parametrizado em `apps/api/test/unit/authz.spec.ts` replica a tabela à mão: mexer no
catálogo sem revisar a decisão quebra o CI.

A Fase 4 completou o que faltava: `filiais_allowed` é verificado no parâmetro e aplicado na
consulta (`FiliaisScopeService`), o tenant-context usa `SET LOCAL` em toda leitura de dado de
tenant (`TenantDatabase`), a suíte A→B é gerada do router e `platform_admin` existe como papel
global, com MFA obrigatório e painel próprio (`/platform/*`, respondendo 404 a quem não opera).

Ainda em aberto: `erp.approve` por flag na membership (chega com o épico E10) e o break-glass
auditado do §4.5 (E9-03).

## 5. Testes obrigatórios de autorização (ver doc 17)

- Viewer tenta gerenciar usuários → 403.
- Manager sem `erp.approve` tenta aprovar → 403.
- Usuário com `filiais_allowed=[1]` consulta filial 2 → 403 e não vaza existência de dados.
- Auditor tenta alterar regra de alerta → 403.
- Proponente = aprovador → 422 regra de segregação.
- Usuário de tenant A com id de recurso do tenant B → 404 (não 403, para não confirmar existência).
