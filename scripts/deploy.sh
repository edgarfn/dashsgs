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
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps api web caddy

echo "==> smoke"
./scripts/smoke.sh "${SMOKE_BASE_URL:-http://localhost:3001}"

echo "==> deploy concluído: $APP_VERSION"
echo "    acompanhe o painel de SLO por 15 minutos (doc 19 §4, passo 3)"
