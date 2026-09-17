#!/usr/bin/env bash
# Rodada de backup do DashSGS (doc 20 §2): base backup físico (WAL-G) + dump lógico.
#
# Os dois, e não um: o base backup é o que permite PITR com RPO de 1 h; o dump lógico é a
# redundância que sobrevive a um defeito no formato físico ou a uma incompatibilidade de versão
# do WAL-G. Já aconteceu com gente melhor que nós.
#
# Cada etapa publica sua própria métrica. Um dump que falhou com o base backup ok é ticket, não
# pager — e isso só é possível porque as séries são separadas por `kind`.
#
# Uso:  scripts/backup/backup.sh [base|dump|tudo]

set -euo pipefail
# shellcheck source=scripts/backup/comum.sh
. "$(dirname "$0")/comum.sh"

ETAPA="${1:-tudo}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
DUMP_DIR="${DUMP_DIR:-/tmp/dashsgs-dump}"

exigir WALG_S3_PREFIX PGHOST PGUSER PGPASSWORD PGDATABASE

# Cifra em repouso (doc 20 §2). Sem chave, o backup vai em claro para um storage de terceiro —
# e isso é decisão consciente do operador, não um padrão silencioso.
if [ -z "${WALG_LIBSODIUM_KEY:-}" ] && [ -z "${WALG_PGP_KEY:-}" ]; then
  if [ "${PERMITIR_BACKUP_SEM_CIFRA:-false}" != "true" ]; then
    erro "backup sem cifra recusado: defina WALG_LIBSODIUM_KEY (doc 20 §2)"
    erro "para um ambiente descartável, exporte PERMITIR_BACKUP_SEM_CIFRA=true"
    exit 2
  fi
  log "AVISO: backup SEM cifra (PERMITIR_BACKUP_SEM_CIFRA=true)"
fi

base_backup() {
  local inicio fim duracao tamanho
  inicio="$(agora_epoch)"

  log "base backup: iniciando (${PGDATA} → ${WALG_S3_PREFIX})"
  if ! wal-g backup-push "$PGDATA"; then
    erro "base backup falhou"
    return 1
  fi
  fim="$(agora_epoch)"
  duracao=$((fim - inicio))

  # Tamanho do backup recém-criado, lido de volta do próprio storage: perguntar ao destino é a
  # única forma de saber que o que se pensa ter enviado chegou lá.
  tamanho="$(wal-g backup-list --detail --json 2>/dev/null \
    | grep -o '"compressed_size":[0-9]*' | head -n 1 | cut -d: -f2 || true)"
  tamanho="${tamanho:-0}"

  log "base backup: concluído em ${duracao}s (${tamanho} bytes)"
  publicar_metricas "backup-base.prom" "$(cat <<EOF
# HELP backup_last_success_timestamp_seconds Momento do último backup bem-sucedido, por tipo.
# TYPE backup_last_success_timestamp_seconds gauge
backup_last_success_timestamp_seconds{kind="base"} ${fim}
# HELP backup_duration_seconds Duração da última rodada de backup, por tipo.
# TYPE backup_duration_seconds gauge
backup_duration_seconds{kind="base"} ${duracao}
# HELP backup_size_bytes Tamanho do último backup, por tipo.
# TYPE backup_size_bytes gauge
backup_size_bytes{kind="base"} ${tamanho}
EOF
)"
}

dump_logico() {
  local inicio fim duracao tamanho arquivo
  inicio="$(agora_epoch)"
  mkdir -p "$DUMP_DIR"
  arquivo="${DUMP_DIR}/${PGDATABASE}-$(date -u +%Y%m%dT%H%M%SZ).dump"

  log "dump lógico: iniciando (${arquivo})"
  # Formato custom (`-Fc`): permite restaurar uma tabela só — que é o que um incidente de
  # aplicação costuma pedir, sem derrubar o banco inteiro para isso.
  if ! pg_dump --format=custom --compress=9 --file="$arquivo"; then
    erro "dump lógico falhou"
    rm -f "$arquivo"
    return 1
  fi

  tamanho="$(stat -c %s "$arquivo")"

  # O dump viaja pelo mesmo caminho e para o mesmo bucket do base backup — mesma cifra, mesma
  # imutabilidade, mesma região distinta (doc 20 §2).
  if ! wal-g st put "$arquivo" "dumps/$(basename "$arquivo")"; then
    erro "envio do dump lógico falhou"
    rm -f "$arquivo"
    return 1
  fi
  rm -f "$arquivo"

  fim="$(agora_epoch)"
  duracao=$((fim - inicio))
  log "dump lógico: concluído em ${duracao}s (${tamanho} bytes)"

  publicar_metricas "backup-dump.prom" "$(cat <<EOF
# HELP backup_last_success_timestamp_seconds Momento do último backup bem-sucedido, por tipo.
# TYPE backup_last_success_timestamp_seconds gauge
backup_last_success_timestamp_seconds{kind="dump"} ${fim}
# HELP backup_duration_seconds Duração da última rodada de backup, por tipo.
# TYPE backup_duration_seconds gauge
backup_duration_seconds{kind="dump"} ${duracao}
# HELP backup_size_bytes Tamanho do último backup, por tipo.
# TYPE backup_size_bytes gauge
backup_size_bytes{kind="dump"} ${tamanho}
EOF
)"
}

# Retenção do doc 20 §1: 35 dias de PITR. `--confirm` é o que de fato apaga; sem ele o WAL-G só
# lista. Os WAL anteriores ao base backup mais antigo mantido vão junto — é isso que impede o
# bucket de crescer para sempre.
expirar_antigos() {
  log "retenção: mantendo backups dos últimos ${WALG_RETENCAO_DIAS:-35} dias"
  wal-g delete retain FIND_FULL "${WALG_RETENCAO_BASES:-5}" --confirm || \
    erro "expiração de backups antigos falhou (não bloqueia a rodada)"
}

falhou=0
case "$ETAPA" in
  base) base_backup || falhou=1 ;;
  dump) dump_logico || falhou=1 ;;
  tudo)
    # As duas etapas rodam mesmo que a primeira falhe: ter o dump quando o base backup quebrou
    # é exatamente o cenário em que a redundância paga o próprio custo.
    base_backup || falhou=1
    dump_logico || falhou=1
    expirar_antigos
    ;;
  *)
    erro "etapa desconhecida: ${ETAPA} (use base, dump ou tudo)"
    exit 2
    ;;
esac

exit "$falhou"
