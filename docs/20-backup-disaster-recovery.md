# 20 — Backup e Disaster Recovery

> **Implementado na Fase 10** (17/09/2026): WAL-G embutido na imagem do Postgres, rodada diária
> e teste de restauração semanal automatizado. Ver §6.

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
| Restore automático do último base backup em cluster efêmero + `SELECT` de sanidade + contagens por tabela + cadeia de auditoria | semanal, **duas vezes**: `.github/workflows/restore-test.yml` (mecanismo) e o agendador do container `backup` (storage real) | sucesso registrado em `restore_test_last_success_timestamp_seconds`; falha = alerta |
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

## 6. Implementação (Fase 10)

### Onde o WAL-G mora, e por quê

Dentro da imagem do Postgres (`docker/postgres/Dockerfile`). `archive_command` roda **no**
processo do banco, com acesso ao `pg_wal`; um sidecar só conseguiria fazer base backup, e base
backup sem WAL contínuo dá um RPO de 24 h em vez de 1 h. O serviço `backup` usa a **mesma**
imagem: restaurar com um binário diferente do que gravou é testar outra coisa.

Duas consequências conscientes:

- **A base virou `postgres:17-bookworm`.** Os binários oficiais do WAL-G são ligados à glibc e
  não rodam em musl. Trocar a base de um banco que já tem dados exige `REINDEX DATABASE` —
  glibc e musl ordenam texto diferente, e índice lido sob outra collation devolve resultado
  errado sem acusar erro. A troca foi feita antes de existir instalação com dados reais.
- **O container do banco ganhou saída para a internet**, em uma rede própria (`backup_egress`),
  não na `edge`. Arquivamento contínuo precisa alcançar o object storage; o que se preserva é o
  que importa: nenhuma porta publicada, e nenhuma vizinhança de rede com o proxy da borda.

### O que roda quando

| Quando (UTC) | O quê | Onde |
|---|---|---|
| contínuo | `archive_command = wal-g wal-push %p` | processo do Postgres |
| 06:10 diário | base backup + dump lógico + expiração dos antigos | `scripts/backup/backup.sh` |
| 08:00 de domingo | teste de restauração contra o storage **real** | `scripts/backup/restore-test.sh` |
| 04:30 de domingo | teste de restauração do **mecanismo**, com MinIO efêmero | GitHub Actions |

06:10 UTC ≈ 03:10 em São Paulo: depois do fechamento das lojas e **antes** da purga de retenção
das 03:20 (doc 10 §2) — backup e purga disputando I/O seria a pior combinação possível.

### O que o teste de restauração prova

Nesta ordem, e cada passo elimina um jeito diferente de o backup ser inútil:

1. o base backup baixa e descompacta — o arquivo existe e a chave de cifra abre;
2. o `restore_command` traz WAL do arquivo — sem isso não há PITR, só um retrato diário;
3. o cluster chega a ponto consistente e aceita conexão;
4. as migrações estão aplicadas e as contagens por tabela batem;
5. a cadeia de hash de `app_audit_log` está ligada ponta a ponta.

O passo 4 é o que separa isto de um `tar -t`: um backup pode abrir perfeitamente e estar vazio.
No workflow do CI as contagens ainda são comparadas com as da **origem** — backup que restaura
com metade das linhas passa em qualquer teste que só olhe para o destino.

### Cifra

`backup.sh` **recusa** rodar sem `WALG_LIBSODIUM_KEY`. Backup em claro num storage de terceiro é
vazamento com agendamento. A fuga (`PERMITIR_BACKUP_SEM_CIFRA=true`) existe para ambiente
descartável — é o que o CI usa contra o MinIO efêmero — e grita no log quando ligada.

### O que continua em aberto

- **Game-day completo (E9-07)**: VM nova, DNS, app no ar, RTO ≤ 4 h cronometrado. Depende de um
  ambiente de produção que ainda não existe; é go-live, não código.
- **PITR mensal para ponto arbitrário** e **verificação de chaves**: procedimento do runbook
  22 §14, executado à mão até haver produção para automatizar contra.
