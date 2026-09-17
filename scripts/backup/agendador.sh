#!/usr/bin/env bash
# Agendador do container de backup (doc 20 §2).
#
# Um laço de `sleep` em vez de cron: o container é de propósito único, o cron do Debian escreve
# em /var/log que ninguém lê, e o log do container é onde a equipe já procura. Menos uma peça
# para configurar e uma saída a menos para perder.
#
# Horários fixos em UTC, escolhidos para cair no vale: 06:10 UTC ≈ 03:10 em São Paulo, depois do
# fechamento das lojas e antes da purga de retenção das 03:20 (doc 10 §2) — backup e purga
# disputando I/O seria a pior combinação possível.

set -euo pipefail
# shellcheck source=scripts/backup/comum.sh
. "$(dirname "$0")/comum.sh"

BACKUP_HORA_UTC="${BACKUP_HORA_UTC:-06}"
BACKUP_MINUTO_UTC="${BACKUP_MINUTO_UTC:-10}"
# Domingo. O teste de restauração é pesado e não pode disputar máquina com o expediente.
RESTORE_TEST_DIA="${RESTORE_TEST_DIA:-0}"
RESTORE_TEST_HORA_UTC="${RESTORE_TEST_HORA_UTC:-08}"

AQUI="$(dirname "$0")"

log "agendador iniciado — backup diário às ${BACKUP_HORA_UTC}:${BACKUP_MINUTO_UTC} UTC;" \
    "teste de restauração no dia ${RESTORE_TEST_DIA} às ${RESTORE_TEST_HORA_UTC}:00 UTC"

# Uma rodada assim que o container sobe, se ainda não houve nenhuma. Sem isto, um servidor
# provisionado às 07:00 ficaria 23 h sem backup — e o alerta de 26 h não pegaria essa janela.
if [ ! -f "${TEXTFILE_DIR}/backup-base.prom" ]; then
  log "nenhum backup registrado: rodando uma vez agora"
  "${AQUI}/backup.sh" tudo || erro "rodada inicial falhou"
fi

ultimo_backup=""
ultimo_teste=""

while true; do
  hoje="$(date -u +%Y-%m-%d)"
  hora="$(date -u +%H)"
  minuto="$(date -u +%M)"
  dia_semana="$(date -u +%w)"

  if [ "$hora" = "$BACKUP_HORA_UTC" ] && [ "$minuto" = "$BACKUP_MINUTO_UTC" ] \
     && [ "$ultimo_backup" != "$hoje" ]; then
    ultimo_backup="$hoje"
    # `||` e não `set -e`: uma rodada que falha registra e segue. Agendador que morre na
    # primeira falha deixa de tentar justamente quando mais se precisa de uma nova tentativa.
    "${AQUI}/backup.sh" tudo || erro "rodada de backup falhou — alerta sai pela métrica"
  fi

  if [ "$dia_semana" = "$RESTORE_TEST_DIA" ] && [ "$hora" = "$RESTORE_TEST_HORA_UTC" ] \
     && [ "$minuto" = "00" ] && [ "$ultimo_teste" != "$hoje" ]; then
    ultimo_teste="$hoje"
    "${AQUI}/restore-test.sh" LATEST || erro "teste de restauração falhou"
  fi

  sleep 30
done
