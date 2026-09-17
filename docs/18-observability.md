# 18 — Observabilidade

> **Implementado na Fase 10** (17/09/2026). A stack sobe como código em
> `docker/compose.observability.yml`; regras, painéis e sondas vivem em `docker/observability/`.
> O gate `pnpm obs:check` roda no CI e reprova regra ou painel que cite métrica que ninguém
> emite. Ver §8.

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
- `sessions_active` — amostrado pelo **worker** a cada minuto, lendo o banco: gauge de estado
  compartilhado publicado por cada réplica de API viraria N séries iguais e nenhum `sum()`
  confiável
- `login_failures_total{reason}` — `reason` é o vocabulário fechado da auditoria de authn
- `export_jobs_total{status}` — `ok`, `muito_grande`, `erro`

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

### Retenção e privacidade (Fase 9)
- `retention_pending_rows{policy}` — linhas fora do prazo **ainda presentes**. O valor correto é
  sempre zero; qualquer outro é retenção prometida e não cumprida (doc 10 §2).
- `retention_rows_purged_total{policy}` — o que a purga apagou, por política.
- `retention_last_run_timestamp_seconds` — quando a rodada diária concluiu pela última vez.

### Break-glass (Fase 10)
- `breakglass_grants_active` — concessões aprovadas, não revogadas e dentro do prazo.
- `breakglass_oldest_grant_seconds` — idade da mais antiga; **zero** quando não há nenhuma, e não
  série ausente, porque regra de alerta sobre série que some é a que não dispara no dia em que
  importa. O teto do serviço é 8 h: passar disso é invariante do produto violada, não "quase no
  limite".

### Backup e restauração (Fase 10 — textfile, não aplicação)
Escritas por `scripts/backup/*.sh` no diretório do textfile collector do node-exporter. A
aplicação não as publica de propósito: um backup que não rodou não tem processo vivo para
reportar nada, e é justamente esse o caso que precisa de alerta.
- `backup_last_success_timestamp_seconds{kind}` · `backup_duration_seconds{kind}` ·
  `backup_size_bytes{kind}` — `kind` é `base` (WAL-G) ou `dump` (pg_dump).
- `restore_test_last_success_timestamp_seconds` · `restore_test_last_result` ·
  `restore_test_duration_seconds` · `restore_test_rows_checked{tabela}`.

### Banco/Redis
- exporters padrão (pg_stat, redis) + `pg_locks`, replication/backup status.
- `pg_stat_archiver_archived_count` e `pg_stat_archiver_failed_count` vêm de uma consulta
  adicional (`docker/observability/postgres-exporter/queries.yml`): o exporter não as publica de
  fábrica, e são elas que sustentam o alerta de WAL não arquivado — o defeito que tira o PITR
  sem tirar o banco do ar.

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
| Credencial ERP inválida | `sg_token_refresh_total{result=~"credenciais_invalidas\|rota_nao_contratada"}` > 0 (por tenant). O rótulo **não** é `unauthorized`: o vocabulário real é o `SgFalha` do cliente SG, e é o gate `obs:check` que impede a regra de voltar a citar um valor que ninguém emite |
| Circuit aberto prolongado | `sg_circuit_state=2` por > 30 min |
| DLQ crescendo | `queue_dlq_depth` > 0 por 15 min |
| Quarentena anômala | `sg_invalid_items_total` taxa > limiar (drift de contrato SG) |
| Disco/CPU/RAM | thresholds clássicos por host |
| Backup falhou | job de backup sem sucesso nas últimas 26 h |
| Certificado TLS | expira < 15 dias |
| Retenção não cumprida | `retention_pending_rows` > 0 por 24 h (compromisso do doc 10 §2) |
| Purga parou | `retention_last_run_timestamp_seconds` mais velho que 36 h |
| Break-glass demorado | `breakglass_oldest_grant_seconds` > 8 h (pager) |
| Break-glass aberto | `breakglass_grants_active` > 0 por 10 min (ticket). "Fora de janela de incidente" não é computável — quem sabe se há incidente é a equipe; o alerta pede a confirmação humana de que existe chamado correspondente |
| Teste de restauração atrasado | sem sucesso há mais de 8 dias (doc 20 §3) |
| WAL não arquivado | `pg_stat_archiver_failed_count` > 0 e nada arquivado na última hora |

## 6. Traces (fase 2)

Spans: request → serviço → SQL; job de sync → chamadas SG (span por página) → upsert.
Sampling: 10% de leitura, 100% de erros e de jobs de sync. `tenant_id` como atributo.

## 7. Painéis Grafana mínimos

1. Visão da plataforma: tráfego, erros, latência, sessões.
2. Sincronização por tenant: lag, runs, quarentena, circuito, chamadas SG.
3. Fila/Workers: profundidade, DLQ, duração de jobs.
4. Banco: conexões, locks, tamanho de partições, vacuum.
5. SLO board: budgets e burn rates.

## 8. Como isso roda (Fase 10)

### Arquivos

| Onde | O quê |
|---|---|
| `docker/compose.observability.yml` | Prometheus, Alertmanager, Grafana, Loki, Promtail, blackbox e os três exporters. Sobrepõe-se ao compose de staging: `pnpm obs:up` |
| `docker/observability/prometheus/prometheus.yml` | alvos — API e worker são **alvos separados** |
| `.../regras/slo.rules.yml` | os seis SLIs do §4 como regras de gravação |
| `.../regras/alertas.rules.yml` | os alertas do §5 + burn rate multi-janela |
| `docker/observability/alertmanager/alertmanager.yml.tmpl` | roteamento (`page` × `ticket`) e inibições |
| `docker/observability/grafana/paineis/*.json` | os cinco painéis do §7, provisionados como código |
| `docker/observability/postgres-exporter/queries.yml` | `pg_stat_archiver`, que o exporter não traz de fábrica |
| `scripts/check-observability.mjs` | o gate (`pnpm obs:check`), job do CI |

### Por que há um passo de renderização

Nem o Prometheus nem o Alertmanager expandem `${VAR}` no arquivo de configuração. Um arquivo que
*parece* interpolar e não interpola manda alerta para o endereço literal `${ONCALL}` — e ninguém
descobre isso até o primeiro incidente. O serviço `obs-config` substitui marcadores
`__MAIUSCULO__` no boot e **falha** se algum sobrar.

### O gate, e por que ele existe

`pnpm obs:check` confere quatro coisas antes do merge:

1. toda métrica citada em regra ou painel existe — no registro da aplicação, entre as séries
   gravadas pelas próprias regras, ou nos prefixos dos exporters;
2. todo valor de rótulo **fechado** casado numa regra existe em `VOCABULARIO_METRICAS`
   (`apps/api/src/common/metrics/metrics.service.ts`);
3. todo alerta traz `resumo` e `runbook` — alerta sem procedimento é ruído com hora marcada;
4. os JSON dos painéis são válidos e não repetem `uid`.

O item 2 é o que mais paga: um alerta sobre `sg_token_refresh_total{result="unauthorized"}` —
nome plausível, rótulo que o código nunca emite — não falha, não avisa e não dispara. Fica quieto
para sempre, e o sintoma é idêntico a "está tudo bem". Esse exato erro estava escrito na tabela
do §5 desta página antes da Fase 10.

### Acesso

Nada da stack publica porta pública. O Grafana escuta em `127.0.0.1` e se chega nele por túnel
SSH (`ssh -L 3000:127.0.0.1:3000 <host>`); `/metrics` continua respondendo 404 na borda
(`docker/Caddyfile`). Painel de operação com login aberto na internet é superfície de ataque
nova para resolver a conveniência de uma pessoa.
