# 23 — Referência da API Interna (BFF) — v1 (draft)

API REST consumida pelo frontend. Prefixo `/api/v1`. Autenticação: cookie de sessão + CSRF em
mutações. Todas as respostas de erro: `{code, message, correlationId, timestamp}`. Paginação:
`?page=&pageSize=` → `{data, page, pageSize, totalPages, totalItems}`. Todos os endpoints de
dados aceitam `?filiais=1,2` (validado contra `filiais_allowed`).

> A referência da API SG externa está no doc 03 (inventário); esta é a NOSSA API.

## Auth
| Método/rota | Descrição | Permissão |
|---|---|---|
| POST /auth/login | e-mail+senha (+`totp` se habilitado) → cria sessão | pública (rate-limited) |
| POST /auth/logout | revoga sessão | autenticado |
| POST /auth/password/forgot · /reset | fluxo de recuperação | pública |
| POST /auth/password/change | troca com senha atual | autenticado |
| GET/DELETE /auth/sessions[/:id] | listar/revogar sessões | autenticado |
| POST /auth/mfa/setup · /verify · /disable | TOTP | autenticado (+MFA p/ disable) |
| GET /me | perfil + memberships + permissões efetivas | autenticado |

## Tenancy & administração
| Rota | Descrição | Permissão |
|---|---|---|
| GET /tenant | dados do tenant corrente + módulos | autenticado |
| GET/POST/PATCH /tenant/users, /tenant/invites | gestão de membros | users.manage |
| GET/PUT /tenant/erp-connection | conexão ERP (senha write-only) | erp_connection.manage (+MFA) |
| POST /tenant/erp-connection/test | health + rotas detectadas | erp_connection.manage |
| POST /tenant/erp-connection/resync | dispara re-sync (domínio/período) | erp_connection.manage |
| GET/PUT /tenant/modules | módulo clientes / escrita ERP (com aceite DPIA) | modules.manage (+MFA) |
| GET /tenant/sync-status | watermarks, lag, últimos runs | autenticado |
| GET /tenant/audit?filters | trilha de auditoria | audit.view |

## Dashboard / dados (leitura; cache conforme doc 14 §6)

**Implementado na Fase 7** (uma chamada por tela — ver doc 15 §10):

| Rota | Retorna | Cache |
|---|---|---|
| GET /dashboard/home?filiais&custo | hoje (venda, cupons, ticket, curva, filiais) + último dia fechado + status de fechamento | 60 s |
| GET /dashboard/vendas/dia?data&filiais&caixa&canceladas&pagina | cupons paginados, totais e formas de pagamento | 60 s (hoje) / 15 min |
| GET /dashboard/vendas/comparativo?de&ate&filiais&custo | série diária, ranking de filiais, departamentos e dia da semana | 15 min |
| GET /dashboard/estoque?situacao&curva&filiais&pagina | ruptura / negativo / excesso com cobertura | 15 min |
| GET /dashboard/financeiro?de&ate&filiais | aging, fluxo previsto, despesas e cartões (manager+) | 15 min |
| GET /dashboard/compras?de&ate&filiais | pedidos por situação, lead time, pendentes e entradas | 15 min |
| GET /dashboard/vendas/dia/export?… | CSV do diário (`reports.export`) | sem cache |
| GET /dim/filiais | dimensões para os filtros | — |

**Planejado** (entra com o sync correspondente):

| Rota | Retorna |
|---|---|
| GET /kpi/overview?date= | cards da home (hoje + D-1 + meta) |
| GET /kpi/sales/today?groupBy=hour|filial|caixa | tempo real |
| GET /kpi/sales/daily?from&to&groupBy=filial|dep1|weekday | séries consolidadas |
| GET /kpi/sales/products?from&to&order=top|bottom&dep= | ranking produtos |
| GET /kpi/sales/sellers?from&to | por vendedor |
| GET /kpi/sales/payments?from&to | finalizadoras |
| GET /kpi/margin?from&to&level=filial|dep|produto&costBasis= | margens |
| GET /kpi/goals?month= | previsão × realizado (+recortes) |
| GET /stock/ruptures?curva=A&filial= | ruptura priorizada |
| GET /stock/expiring?days=7 | vencimentos |
| GET /stock/losses?from&to&groupBy=motivo|produto | perdas |
| GET /stock/movements?produto=&from&to | extrato de movimentações |
| GET /finance/payables · /receivables?bucket&from&to | aging/parcelas |
| GET /finance/expenses?from&to&groupBy=tipo|dep | despesas |
| GET /finance/cards?from&to&groupBy=bandeira|adquirente | cartões/taxas |
| GET /purchases/orders?situacao=&from&to · /orders/:id | pedidos de compra |
| GET /dim/{filiais,departamentos,marcas,motivos,...} | dimensões p/ filtros |
| POST /export | job de exportação CSV (async) → GET /export/:id | reports.export |

## Alertas

**Implementado na Fase 8:**

| Rota | Descrição | Permissão |
|---|---|---|
| GET /alertas?status&severidade&filialErpId&pagina | feed com contagens (abertos, reconhecidos, críticos) | alerts.ack |
| POST /alertas/:id/reconhecer | marca que alguém assumiu o alerta | alerts.ack |
| GET /alertas/regras | regras do tenant, com limiares e dependências | alerts.manage |
| PATCH /alertas/regras/:id | liga/desliga, severidade, canal e limiares | alerts.manage |
| POST /alertas/avaliar | avalia as regras agora, sem esperar a cadência de 5 min | alerts.manage |

**Planejado:**

| Rota | Descrição | Permissão |
|---|---|---|
| GET /alerts?status=open | feed | alerts.ack |
| POST /alerts/:id/ack | reconhecer | alerts.ack |
| GET/POST/PATCH/DELETE /alert-rules | CRUD regras | alerts.manage |

## Ações no ERP (fase 8; módulo habilitado)
| Rota | Descrição | Permissão |
|---|---|---|
| GET /erp-actions | fila de propostas | erp.propose |
| POST /erp-actions {type, payload} | criar proposta (validada contra schema da ação) | erp.propose |
| POST /erp-actions/:id/approve · /reject | decisão (≠ proponente; MFA ≤15 min) | erp.approve |
| GET /erp-actions/:id | detalhe + resultado da execução | envolvidos |

## Convenções de erro (códigos internos principais)
`AUTH_INVALID_CREDENTIALS, AUTH_MFA_REQUIRED, AUTH_LOCKED, FORBIDDEN, NOT_FOUND,
VALIDATION_ERROR, RATE_LIMITED, ERP_UNREACHABLE, ERP_CREDENTIALS_INVALID, ERP_ROUTE_FORBIDDEN,
EXPORT_LIMIT, CONFLICT, INTERNAL` — mapeados para 400/401/403/404/409/422/429/500/502.

OpenAPI interno é gerado do código (decorators) e diffado no CI (doc 09 §3 API9).
