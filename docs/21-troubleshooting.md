# 21 — Manual de Troubleshooting

Formato: sintoma → diagnóstico → ação. Sempre começar por: painel "Sincronização por tenant"
(Grafana) e `correlation_id` do erro reportado.

## 1. Integração SG

| Sintoma | Diagnóstico | Ação |
|---|---|---|
| "Credencial ERP inválida" na UI / `ERP_CREDENTIALS_INVALID` | `sg_token_refresh_total{result=unauthorized}` > 0; POST /autorizacao retorna 401 | Confirmar com o cliente/SG se a senha mudou; atualizar credencial (Admin→Conexão); ver auditoria de quem alterou por último |
| Sync parado, circuit aberto | `sg_circuit_state=2`; logs `ERP_UNREACHABLE` | Testar `GET /status` manualmente do host; verificar VPN/túnel; ERP fora do ar? Acionar contato do tenant; breaker fecha sozinho ao voltar |
| 401 intermitente em rotas com token válido | Diff de `routes_granted` (evento `erp.routes.changed`) | Rota saiu do contrato do cliente na SG → feature degradada automaticamente; alinhar contrato |
| Dados de vendas de hoje não atualizam | Job `sync:tenant:vendas_hoje` com erro? DLQ? | Ver `sync_job_runs`; se 400 "Filial não encontrada": filial desativada no ERP → atualizar dimensões e config de filiais do tenant |
| Dia fechado não aparece | Flags do resumo: `gerouVendasDiaria=false` | O ERP ainda não fechou o dia — não é bug nosso; alerta "fechamento atrasado" cobre isso |
| Quarentena alta (`sg_invalid_items_total`) | Amostras em `sync_job_runs.error` | Drift de contrato da SG (campo novo/tipo mudou) → ajustar schema/mapper; abrir chamado SG se breaking |
| Backfill lento | `sg_rate_limit_wait_seconds` alto | Aumentar `maxRps` com aval do tenant OU ampliar janela noturna; nunca remover o limite |
| Duplicidade aparente de valores | Dia com realtime + consolidado misturados? | Verificar job de consolidação (delete+insert do dia); rodar reconciliação (runbook 22 §4) |

## 2. Aplicação

| Sintoma | Diagnóstico | Ação |
|---|---|---|
| 500 com correlation id | Sentry pelo id | Corrigir; se recorrente, rollback do release |
| Lentidão no dashboard | p95 alto em rota específica; `pg_stat_statements` | Índice faltando/partição não podada; verificar cache hit do Redis |
| Login falhando p/ todos | Redis fora? (sessões) | `redis-cli ping`; failover/restart; sessões são re-criáveis |
| 429 excessivo | rate limit mal calibrado ou abuso | Ver IP/sessão no log; ajustar limite ou bloquear origem |
| E-mails não chegam | fila `notifications` DLQ; provedor SMTP | Reprocessar DLQ (runbook 22 §6); verificar reputação/domínio |
| Usuário não vê filial X | `filiais_allowed` da membership | Admin ajusta; conferir auditoria |
| Export vazio/mascarado "errado" | permissão de desmascaramento | Comportamento esperado (doc 10); conceder permissão se legítimo |

## 3. Banco e infraestrutura

| Sintoma | Diagnóstico | Ação |
|---|---|---|
| Disco crescendo rápido | tamanho por tabela/partição | Purga de partições vencidas (job de retenção); VACUUM; conferir `sync_api_call_log` TTL |
| Conexões esgotadas | pool da app vs max_connections | PgBouncer/ajuste de pool; procurar vazamento de transação (transação presa com SET LOCAL) |
| RLS "bloqueando tudo" (consultas vazias) | `current_setting('app.tenant_id', true)` nulo | Interceptor não setou contexto — bug: nunca contornar com BYPASS; corrigir o caminho de código |
| Backup falhou | job WAL-G | Espaço/credencial do storage; alerta já dispara; validar próximo ciclo |
| Certificado expirando | alerta TLS | Caddy renova sozinho; se falhou: porta 80 bloqueada? DNS? |

## 4. Onde olhar (mapa rápido)

- Logs: Grafana→Loki, filtro `correlation_id` / `tenant_id`.
- Erros: Sentry (release, breadcrumb).
- Sync: tabela `sync_job_runs`, painel Sincronização, `sync_watermarks`.
- Auditoria de ações: Admin→Auditoria (na UI) — inclui mudanças de conexão/permissão.
- Saúde ERP: Admin→Conexão (status, último /status, rotas).
