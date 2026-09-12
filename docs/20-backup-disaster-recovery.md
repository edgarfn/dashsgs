# 20 — Backup e Disaster Recovery

## 1. Objetivos

| Métrica | Alvo | Racional |
|---|---|---|
| RPO | 1 h | WAL contínuo; perda máxima de 1 h de dados de app. Dados do ERP são **re-sincronizáveis** da fonte (o espelho não é o único registro) — perda real limitada a auditoria/alertas/config |
| RTO | 4 h | restore + smoke em VM nova |
| Retenção | 35 dias PITR + mensal 12 meses (auditoria: 5 anos em arquivo separado) | LGPD/contratos |

## 2. O que é copiado

| Item | Método | Frequência | Destino |
|---|---|---|---|
| PostgreSQL | WAL-G: base backup diário + WAL contínuo (PITR) | contínuo | Object storage em **outra região/provedor**, cifrado (age/KMS), object-lock/immutability ligado |
| Dump lógico (pg_dump custom) | redundância independente do formato físico | diário | idem |
| `app_audit_log` | export mensal assinado (hash raiz) | mensal | storage de arquivo (5 anos) |
| Configuração/IaC | git (repo privado) + bundle | contínuo | espelho do repo |
| Segredos (SOPS) | repo cifrado; chave age em 2 cofres físicos/gerenciados | a cada mudança | — |
| Grafana/dashboards | provisionamento como código | contínuo | git |
| Redis | **não** é copiado (cache/filas re-deriváveis); DLQ crítica drenada para Postgres | — | — |

Não copiar: espelho ERP pode ser excluído do dump lógico diário se a janela apertar
[RECOMENDAÇÃO: manter no PITR físico; em DR extremo, re-backfill da API SG].

## 3. Testes de restauração (sem isso, backup não é válido)

| Teste | Frequência | Critério |
|---|---|---|
| Restore automático do último base backup em VM efêmera + `SELECT` de sanidade + contagens por tenant | semanal (CI agendado) | sucesso registrado; falha = alerta crítico |
| PITR para ponto arbitrário (T-25 h) | mensal | dados consistentes no ponto |
| Game-day completo (VM nova, DNS, app no ar) | semestral | RTO ≤ 4 h comprovado, relatório |
| Verificação de cifra/chaves (decrypt de amostra) | mensal | chaves íntegras e acessíveis |

## 4. Cenários de desastre e resposta

| Cenário | Resposta |
|---|---|
| Perda da VM de app | Provisionar VM (script cloud-init) → deploy digest atual → apontar DNS. Banco intacto (volume/gerenciado) |
| Corrupção/perda do banco | Restore PITR no último ponto são → validar → religar app → re-sync ERP das janelas recentes (watermarks regridem junto — reprocessamento idempotente cobre o gap) |
| Ransomware/comprometimento | Isolar, acionar doc 27; restaurar a partir de backup **imutável** anterior ao comprometimento em infra nova; rotação total de segredos |
| Perda do provedor/região | Backups estão em provedor distinto; reconstruir por IaC (game-day cobre) |
| Perda de chave de cifra | Impossibilitada por design: chave em 2 cofres independentes; teste mensal |
| ERP do tenant perdeu dados | Fora do nosso escopo de DR, mas nosso espelho vira ativo: oferecer export ao tenant (bônus de valor) |

## 5. Papéis e runbook

- Responsável primário: on-call de plataforma; decisão de DR: fundador/CTO.
- Passo-a-passo executável (comandos) mantido no runbook 22 §9 e testado no game-day.
- Comunicação: status page + e-mail a admins de tenants se indisponibilidade > 30 min.
