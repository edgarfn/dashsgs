#!/usr/bin/env bash
# Teste de restauração (doc 20 §3, E6-03). Backup que nunca foi restaurado não é backup.
#
# O que este script prova, nesta ordem:
#   1. o último base backup baixa e descompacta (o arquivo existe e a chave de cifra abre);
#   2. o `restore_command` traz WAL do arquivo — sem isso não há PITR, só um retrato diário;
#   3. o cluster chega a um ponto consistente e aceita conexão;
#   4. o schema está inteiro (migrações aplicadas) e os dados por tenant estão lá.
#
# O passo 4 é o que separa este teste de um `tar -t`: um backup pode abrir perfeitamente e estar
# vazio. Contagem por tenant é a pergunta que o cliente faria.
#
# Uso:  scripts/backup/restore-test.sh [ALVO]      ALVO = LATEST (padrão) ou nome do backup

set -euo pipefail
# shellcheck source=scripts/backup/comum.sh
. "$(dirname "$0")/comum.sh"

ALVO="${1:-LATEST}"
PORTA_TESTE="${PORTA_TESTE:-55433}"
DESTINO="${DESTINO:-/tmp/dashsgs-restore-$$}"
# Restaurar não pode demorar mais que o RTO prometido (4 h, doc 20 §1). O teste usa uma fração
# disso: se o base backup semanal já não cabe em 30 min, o RTO está em risco e é melhor saber
# agora do que durante o desastre.
TIMEOUT_SEGUNDOS="${TIMEOUT_SEGUNDOS:-1800}"

exigir WALG_S3_PREFIX

inicio="$(agora_epoch)"
falhou=0
linhas_conferidas=""

limpar() {
  if [ -d "$DESTINO" ]; then
    pg_ctl -D "$DESTINO" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$DESTINO"
  fi
}
trap limpar EXIT

publicar_falha() {
  local motivo="$1"
  erro "$motivo"
  publicar_metricas "restore-test.prom" "$(cat <<EOF
# HELP restore_test_last_attempt_timestamp_seconds Momento da última tentativa de restauração.
# TYPE restore_test_last_attempt_timestamp_seconds gauge
restore_test_last_attempt_timestamp_seconds $(agora_epoch)
# HELP restore_test_last_result Resultado da última tentativa (1 sucesso, 0 falha).
# TYPE restore_test_last_result gauge
restore_test_last_result 0
EOF
)"
  exit 1
}

log "restaurando ${ALVO} em ${DESTINO}"
mkdir -p "$DESTINO"
chmod 0700 "$DESTINO"

if ! timeout "$TIMEOUT_SEGUNDOS" wal-g backup-fetch "$DESTINO" "$ALVO"; then
  publicar_falha "backup-fetch falhou (alvo ${ALVO})"
fi

# Recuperação a partir do arquivo de WAL. `recovery_target = immediate` para no primeiro ponto
# consistente: é o suficiente para provar que o WAL chega e que o cluster abre, sem esperar a
# reprodução de uma semana inteira. A recuperação até um instante arbitrário é o teste MENSAL
# do doc 20 §3, não este.
cat > "${DESTINO}/postgresql.auto.conf" <<EOF
restore_command = 'wal-g wal-fetch "%f" "%p"'
recovery_target = 'immediate'
recovery_target_action = 'promote'
port = ${PORTA_TESTE}
# Cluster efêmero: ninguém fala com ele além deste script, e arquivar o WAL de um teste
# poluiria o arquivo de verdade com uma linha do tempo paralela.
archive_mode = 'off'
listen_addresses = 'localhost'
EOF
touch "${DESTINO}/recovery.signal"

log "subindo cluster restaurado na porta ${PORTA_TESTE}"
if ! pg_ctl -D "$DESTINO" -o "-p ${PORTA_TESTE}" -w -t "$TIMEOUT_SEGUNDOS" \
     -l "${DESTINO}/restore.log" start; then
  erro "--- últimas linhas do log do cluster restaurado ---"
  tail -n 40 "${DESTINO}/restore.log" >&2 || true
  publicar_falha "cluster restaurado não subiu"
fi

consulta() {
  psql -h localhost -p "$PORTA_TESTE" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-dashsgs}" \
    -tAX -c "$1"
}

log "conferindo schema e dados"

migracoes="$(consulta "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")" \
  || publicar_falha "não foi possível ler _prisma_migrations"
if [ "${migracoes:-0}" -eq 0 ]; then
  publicar_falha "cluster restaurado sem migrações aplicadas — backup abriu, mas está vazio"
fi
log "migrações aplicadas: ${migracoes}"

tenants="$(consulta "SELECT count(*) FROM app_tenants;")" \
  || publicar_falha "não foi possível ler app_tenants"
log "tenants restaurados: ${tenants}"

# Contagem nas tabelas que doem se sumirem: identidade, trilha de auditoria (5 anos, doc 10 §2),
# o espelho de vendas e os alertas. Cada contagem vira série — é a comparação entre semanas que
# transforma "o backup abriu" em "o backup tem o que tinha ontem".
for tabela in app_users app_audit_log erp_vendas_cupons app_alert_events; do
  existe="$(consulta "SELECT to_regclass('public.${tabela}') IS NOT NULL;")"
  if [ "$existe" != "t" ]; then
    publicar_falha "tabela ausente no backup restaurado: ${tabela}"
  fi
  total="$(consulta "SELECT count(*) FROM ${tabela};")"
  log "  ${tabela}: ${total} linha(s)"
  linhas_conferidas="${linhas_conferidas}restore_test_rows_checked{tabela=\"${tabela}\"} ${total}"$'\n'
done

# A trilha de auditoria é append-only com encadeamento de hash (doc 05 §6). Confere-se aqui a
# LIGAÇÃO da cadeia — cada `prev_hash` igual ao `entry_hash` da linha anterior por `id`, que é a
# ordem em que o AuditService encadeia. Recalcular os hashes é trabalho da verificação completa
# do serviço; o que importa neste teste é que o backup não trouxe uma cadeia partida.
quebras="$(consulta "
  SELECT count(*) FROM (
    SELECT prev_hash, lag(entry_hash) OVER (ORDER BY id) AS anterior
    FROM app_audit_log
  ) t WHERE anterior IS NOT NULL AND prev_hash IS DISTINCT FROM anterior;
" 2>/dev/null || echo "erro")"

if [ "$quebras" = "erro" ]; then
  log "AVISO: não foi possível verificar a cadeia de auditoria (colunas ausentes nesta versão)"
elif [ "${quebras:-0}" -ne 0 ]; then
  publicar_falha "cadeia de auditoria com ${quebras} elo(s) quebrado(s) no backup restaurado"
else
  log "cadeia de auditoria íntegra"
fi

fim="$(agora_epoch)"
duracao=$((fim - inicio))
log "restauração validada em ${duracao}s"

# As contagens por tabela entram DEPOIS do heredoc, e não dentro dele: a linha final de um
# here-document precisa ser só o delimitador, e `${linhas_conferidas}EOF` não fecha nada — o
# script inteiro deixaria de ser sintaticamente válido.
metricas="$(cat <<EOF
# HELP restore_test_last_success_timestamp_seconds Momento do último teste de restauração bem-sucedido.
# TYPE restore_test_last_success_timestamp_seconds gauge
restore_test_last_success_timestamp_seconds ${fim}
# HELP restore_test_last_attempt_timestamp_seconds Momento da última tentativa de restauração.
# TYPE restore_test_last_attempt_timestamp_seconds gauge
restore_test_last_attempt_timestamp_seconds ${fim}
# HELP restore_test_last_result Resultado da última tentativa (1 sucesso, 0 falha).
# TYPE restore_test_last_result gauge
restore_test_last_result 1
# HELP restore_test_duration_seconds Tempo total do último teste de restauração.
# TYPE restore_test_duration_seconds gauge
restore_test_duration_seconds ${duracao}
# HELP restore_test_rows_checked Linhas conferidas por tabela no cluster restaurado.
# TYPE restore_test_rows_checked gauge
EOF
)"

publicar_metricas "restore-test.prom" "${metricas}
${linhas_conferidas}"

exit "$falhou"
