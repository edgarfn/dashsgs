#!/usr/bin/env bash
# Funções compartilhadas pelos scripts de backup e de restauração (doc 20).
#
# Regra deste arquivo: nada aqui pode falhar em silêncio. Backup é a única parte do sistema cujo
# defeito não aparece enquanto tudo vai bem — só no dia em que se precisa dele.

set -euo pipefail

# Onde o node-exporter lê as métricas de backup (doc 18 §5). Diretório inexistente não é erro:
# rodar o script à mão, fora do compose, tem que continuar funcionando.
TEXTFILE_DIR="${TEXTFILE_DIR:-/textfile}"

log() {
  printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

erro() {
  printf '%s [backup] ERRO: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

exigir() {
  local faltando=0
  for nome in "$@"; do
    if [ -z "${!nome:-}" ]; then
      erro "variável obrigatória não definida: ${nome}"
      faltando=1
    fi
  done
  [ "$faltando" -eq 0 ] || exit 2
}

# Escreve o arquivo de métricas de forma ATÔMICA. Sem o `mv`, o node-exporter pode raspar um
# arquivo pela metade e publicar um `backup_last_success_timestamp_seconds` truncado — que é
# pior do que não publicar nada, porque parece um dado.
publicar_metricas() {
  local arquivo="$1"
  local conteudo="$2"

  if [ ! -d "$TEXTFILE_DIR" ]; then
    log "TEXTFILE_DIR ${TEXTFILE_DIR} não existe — métricas não publicadas"
    return 0
  fi

  local destino="${TEXTFILE_DIR}/${arquivo}"
  if ! printf '%s\n' "$conteudo" > "${destino}.tmp" 2>/dev/null; then
    erro "sem permissão de escrita em ${TEXTFILE_DIR}: o sucesso não será publicado e o"
    erro "alerta vai disparar sobre uma rodada que deu certo. Confira o dono do volume."
    return 1
  fi
  mv "${destino}.tmp" "$destino"
  log "métricas publicadas em ${destino}"
}

agora_epoch() {
  date -u +%s
}
