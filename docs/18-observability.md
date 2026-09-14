# 18 — Observabilidade

Stack: OpenTelemetry SDK → Prometheus (métricas) + Loki (logs) + Tempo (traces, fase 2) +
Grafana (painéis/alertas) + Sentry (exceções). Tudo com label `tenant_id` onde fizer sentido
(cardinalidade controlada: tenant sim, produto não).

## 1. Logs estruturados (JSON)

Campos padrão: `ts, level, msg, service, correlation_id, tenant_id?, user_id?, module, event`.

| Política | Regra |
|---|---|
| Redaction | processor remove/mascara: password, senha, token, authorization, secret, cpf, cnpj, email (allowlist de campos loggáveis por evento) |
| PII | Proibida em logs de aplicação; auditoria de negócio vai para `app_audit_log`, não para Loki |
| Correlation | Gerado na borda (request) e propagado a jobs (`job_id` + `origin_correlation_id`) |
| Retenção | app 30 d; security (authn/authz/audit-espelho) 90 d; Loki com compactação |
| Níveis | error (acionável), warn (degradação), info (eventos de negócio/sync), debug (desligado em prod) |

## 2. Métricas (Prometheus)

### Aplicação
- `http_request_duration_seconds{route,method,status}` (histograma)
- `http_requests_total`; `http_errors_total`
- `sessions_active`; `login_failures_total{reason}`
- `export_jobs_total{status}`

### Integração SG (núcleo do produto)
- `sg_api_calls_total{tenant,endpoint,status}`
- `sg_api_duration_seconds{endpoint}` (histograma)
- `sg_token_refresh_total{tenant,result}`
- `sg_circuit_state{tenant}` (0 fechado/1 meio/2 aberto)
- `sg_invalid_items_total{tenant,domain}` (quarentena)
- `sg_rate_limit_wait_seconds{tenant}`

### Sincronização
- `sync_runs_total{tenant,domain,status}`
- `sync_duration_seconds{domain}`
- `sync_lag_seconds{tenant,domain}` = agora − watermark (alerta se estourar SLO)
- `sync_items_upserted_total{domain}`
- `queue_depth{queue}`; `queue_dlq_depth{queue}`; `job_retries_total`

As métricas de sync nascem no **processo de worker**, que expõe `/metrics` e `/healthz` na porta
`WORKER_PORT` (padrão 3002) — o Prometheus raspa API e worker como alvos separados.

### Alertas (Fase 8)
- `alert_events_total{tenant,type}` (já deduplicados — é o volume que o cliente sente)
- `alert_notifications_total{tenant,result}`
- `alert_delivery_seconds{type}` (evento → despacho da notificação; SLO do §4)

### Banco/Redis
- exporters padrão (pg_stat, redis) + `pg_locks`, replication/backup status.

## 3. Health checks

| Endpoint | Verifica | Uso |
|---|---|---|
| `/healthz` (liveness) | processo responde | restart de container |
| `/readyz` (readiness) | Postgres ping, Redis ping, migrações aplicadas | balanceador/deploy |
| Job `erp-health` por tenant | POST autorizacao + GET /status | status de conexão na UI, alerta |

## 4. SLI / SLO

| SLI | SLO | Janela |
|---|---|---|
| Disponibilidade do dashboard (2xx+3xx / total em rotas de leitura) | 99,5% | 30 d |
| Latência p95 de consultas de dashboard | < 300 ms | 7 d |
| Frescor tempo-real (`sync_lag` de vendas/hoje em horário de loja) | ≤ 10 min p95 | 7 d |
| Frescor consolidado (dia fechado disponível após detecção do fechamento) | ≤ 60 min p95 | 30 d |
| Sucesso de sync (runs ok / total, excluindo ERP indisponível) | ≥ 99% | 7 d |
| Entrega de alertas (evento → notificação) | ≤ 5 min p95 | 7 d |

Error budget: alertas de burn rate (fast 2%/1 h, slow 5%/6 h).

## 5. Alertas operacionais (Grafana Alerting → e-mail/on-call)

| Alerta | Condição |
|---|---|
| API interna degradada | p95 > 1 s por 10 min ou 5xx > 2% |
| Sync parado | `sync_lag_seconds` > SLO ×2 para qualquer tenant/domínio essencial |
| Credencial ERP inválida | `sg_token_refresh_total{result=unauthorized}` > 0 (por tenant) |
| Circuit aberto prolongado | `sg_circuit_state=2` por > 30 min |
| DLQ crescendo | `queue_dlq_depth` > 0 por 15 min |
| Quarentena anômala | `sg_invalid_items_total` taxa > limiar (drift de contrato SG) |
| Disco/CPU/RAM | thresholds clássicos por host |
| Backup falhou | job de backup sem sucesso nas últimas 26 h |
| Certificado TLS | expira < 15 dias |

## 6. Traces (fase 2)

Spans: request → serviço → SQL; job de sync → chamadas SG (span por página) → upsert.
Sampling: 10% de leitura, 100% de erros e de jobs de sync. `tenant_id` como atributo.

## 7. Painéis Grafana mínimos

1. Visão da plataforma: tráfego, erros, latência, sessões.
2. Sincronização por tenant: lag, runs, quarentena, circuito, chamadas SG.
3. Fila/Workers: profundidade, DLQ, duração de jobs.
4. Banco: conexões, locks, tamanho de partições, vacuum.
5. SLO board: budgets e burn rates.
