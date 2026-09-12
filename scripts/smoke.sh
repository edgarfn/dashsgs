#!/usr/bin/env bash
# Smoke test pós-deploy (doc 19 §4). Falha rápido e com a razão explícita.
#   ./scripts/smoke.sh http://localhost:3001
set -Eeuo pipefail

BASE_URL="${1:-http://localhost:3001}"
TIMEOUT="${SMOKE_TIMEOUT:-10}"
failures=0

check() {
  local label="$1" url="$2" expected="$3" grep_for="${4:-}"
  local body status
  body="$(curl -sS --max-time "$TIMEOUT" -w '\n%{http_code}' "$url" || echo -e '\n000')"
  status="$(printf '%s' "$body" | tail -n1)"
  body="$(printf '%s' "$body" | sed '$d')"

  if [[ "$status" != "$expected" ]]; then
    echo "  FALHOU $label — esperado HTTP $expected, veio $status" >&2
    failures=$((failures + 1))
    return
  fi
  if [[ -n "$grep_for" ]] && ! grep -q "$grep_for" <<<"$body"; then
    echo "  FALHOU $label — resposta sem \"$grep_for\"" >&2
    failures=$((failures + 1))
    return
  fi
  echo "  ok $label"
}

echo "==> smoke em $BASE_URL"
check "liveness"        "$BASE_URL/healthz"            200 '"state":"ok"'
check "readiness"       "$BASE_URL/readyz"             200 '"state":"ok"'
check "meta"            "$BASE_URL/api/v1/meta"        200 '"name":"DashSGS"'
# Erro padronizado: contrato do doc 23 vale inclusive para rota inexistente.
check "erro padrão 404" "$BASE_URL/api/v1/inexistente" 404 '"code":"NOT_FOUND"'

if (( failures > 0 )); then
  echo "smoke falhou ($failures verificação(ões)) — faça rollback com o digest anterior" >&2
  exit 1
fi
echo "==> smoke ok"
