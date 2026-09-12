# 13 — Webhooks e Eventos

## 1. Webhooks da API SG: inexistentes

A documentação oficial **não expõe webhooks, callbacks ou eventos push** [DOCUMENTADO pela
ausência — varredura completa da coleção]. Toda a integração é pull (polling). Consequências:

- "Tempo real" = polling curto de `/vendas/hoje` e `/vendas/finalizadoras/hoje` (doc 14).
- Não há notificação de mudança de cadastro; usamos `filtroDataTipo=dataAlteracao*` de
  `/produtos` para detecção incremental de mudanças [DOCUMENTADO], e re-varredura periódica para
  entidades sem timestamp de alteração.

[NECESSITA CONFIRMAÇÃO]: existência de mecanismos push não publicados (perguntar à SG).

## 2. Eventos internos do DashSGS

Arquitetura orientada a eventos internos (BullMQ) para desacoplar sync → agregação → alertas:

| Evento | Produtor | Consumidores |
|---|---|---|
| `sync.domain.completed {tenant, domain, filial, range}` | Worker de sync | Agregador, avaliador de alertas |
| `sync.failed {tenant, domain, error}` | Worker | Notificador (admin tenant), métricas |
| `erp.connection.unhealthy` | Health-check | Notificador, UI status |
| `erp.routes.changed {added, removed}` | Token manager | Feature-flags por tenant, notificação |
| `alert.triggered {rule, dedupe_key}` | Avaliador | Canais de notificação (e-mail, futuro Slack/WhatsApp) |
| `erp.action.approved / executed / failed` | Módulo de ações | Executor, auditoria, UI |
| `tenant.offboarding.requested` | Admin | Pipeline de purge |

Propriedades: consumidores idempotentes (dedupe por chave de evento), retry com DLQ
(dead-letter queue) após 5 tentativas, DLQ monitorada (doc 18) e reprocessável (doc 22).

## 3. Webhooks de SAÍDA do DashSGS (fase 2, opcional)

Para clientes que queiram receber alertas em seus sistemas:

- Registro de endpoint por tenant (URL HTTPS validada anti-SSRF, allowlist de portas 443).
- Assinatura HMAC-SHA256 no header `X-DashSGS-Signature` com secret por endpoint + timestamp
  (janela anti-replay 5 min) + `X-DashSGS-Event-Id` para idempotência do receptor.
- Retry exponencial 5 tentativas; suspensão automática após 24 h de falhas; painel de entregas.
- Payload mínimo (ids e valores do alerta), sem PII.

Este desenho segue as práticas que exigiríamos de terceiros (doc 09) — assinatura, replay
protection, idempotência — e só entra quando houver demanda real.
