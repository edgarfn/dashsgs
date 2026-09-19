#!/usr/bin/env bash
# DashSGS — deploy por digest imutável (doc 19 §4).
#
#   ./scripts/deploy.sh <api-image-digest> <web-image-digest> [env-file]
#
# Rollback = rodar de novo com o digest anterior. Nada é construído aqui: a imagem que sobe é
# exatamente a que passou pelos gates do CI (doc 11 §1).
set -Eeuo pipefail

API_IMAGE="${1:?informe a imagem da API por digest (ex.: ghcr.io/org/dashsgs-api@sha256:...)}"
WEB_IMAGE="${2:?informe a imagem do web por digest}"
ENV_FILE="${3:-.env.staging}"
COMPOSE_FILE="docker/compose.staging.yml"

if [[ "$API_IMAGE" != *"@sha256:"* || "$WEB_IMAGE" != *"@sha256:"* ]]; then
  echo "recusado: use digest (@sha256:...), não tag móvel — artefato tem de ser imutável" >&2
  exit 2
fi

export API_IMAGE WEB_IMAGE
export APP_VERSION="${APP_VERSION:-${API_IMAGE##*@}}"

echo "==> puxando imagens"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull api web

echo "==> aplicando migrações (papel app_migrator)"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up --exit-code-from api-migrate api-migrate

echo "==> subindo serviços"
# Borda: Caddy por padrão. `DEPLOY_EDGE=none` quando um proxy externo (Nginx Proxy Manager,
# Traefik, o proxy do provedor) já ocupa 80/443 — os dois brigariam pela porta. É variável de
# ambiente, e não edição neste arquivo, porque o workflow de deploy roda `git checkout --force`
# na VM: alteração local em arquivo versionado é apagada no deploy seguinte (doc 19 §9.6.4).
SERVICOS=(api web)
[[ "${DEPLOY_EDGE:-caddy}" == "caddy" ]] && SERVICOS+=(caddy)
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps "${SERVICOS[@]}"

# As quatro verificações do smoke batem em rotas da API (/healthz, /readyz, /api/v1/*). Ele
# precisa, portanto, de uma URL que chegue à API — não à do front.
#
# ATENÇÃO ao default: NENHUM serviço deste compose publica 3001 no host — só o Caddy publica
# porta (80/443). `localhost:3001` só responde se você publicou a porta por fora (doc 19 §9.5.5).
#
# `SMOKE_BASE_URL=none` pula a verificação, para a topologia em que a API não tem endereço
# público — caso do front como BFF atrás de um proxy externo, em que só o domínio do app é
# publicado (doc 35 §3). Pular é explícito de propósito: melhor um aviso do que ensinar alguém
# a conviver com um passo que falha sempre.
if [[ "${SMOKE_BASE_URL:-}" == "none" ]]; then
  echo "==> smoke PULADO (SMOKE_BASE_URL=none)"
  echo "    Verifique à mão que a API subiu — o healthcheck do container já testa /healthz:"
  echo "      docker compose -f $COMPOSE_FILE --env-file $ENV_FILE ps"
  echo "    A coluna STATUS deve mostrar (healthy) para api."
else
  echo "==> smoke"
  ./scripts/smoke.sh "${SMOKE_BASE_URL:-http://localhost:3001}"
fi

echo "==> deploy concluído: $APP_VERSION"
echo "    acompanhe o painel de SLO por 15 minutos (doc 19 §4, passo 3)"
