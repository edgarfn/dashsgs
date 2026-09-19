#!/usr/bin/env bash
# DashSGS — cria os papéis do Postgres de staging/produção (doc 19 §6, runbook 22 §0).
#
# `docker/postgres/init/01-roles.sql` só roda sozinho em DESENVOLVIMENTO: é script de
# inicialização de volume do Postgres, e o compose de dev o monta; o de staging/produção
# (docker/compose.staging.yml) não monta nenhum init script de propósito — os papéis levam
# senha real, de cofre, e senha real não entra em arquivo versionado nem em imagem (doc 09 §2).
# Este script é o passo que faltava: mesmos papéis, senhas vindas do ambiente de quem roda.
#
#   APP_RW_PASSWORD=... APP_MIGRATOR_PASSWORD=... APP_READONLY_PASSWORD=... \
#   APP_MONITOR_PASSWORD=... ./scripts/provision-roles.sh [env-file]
#
# Idempotente na medida do Postgres: rodar de novo contra um banco que já tem os papéis falha
# em `CREATE ROLE` (papel existe) — é o sinal certo de "já rodei isto aqui", não um bug.
set -Eeuo pipefail

: "${APP_RW_PASSWORD:?defina APP_RW_PASSWORD}"
: "${APP_MIGRATOR_PASSWORD:?defina APP_MIGRATOR_PASSWORD}"
: "${APP_READONLY_PASSWORD:?defina APP_READONLY_PASSWORD}"
: "${APP_MONITOR_PASSWORD:?defina APP_MONITOR_PASSWORD}"

ENV_FILE="${1:-.env.staging}"
COMPOSE_FILE="docker/compose.staging.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "arquivo de ambiente não encontrado: $ENV_FILE" >&2
  exit 2
fi

# Só o suficiente para autenticar como o superusuário de bootstrap do container — não é o
# `env_file` completo da aplicação, é o do próprio Postgres (doc 19 §3).
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
: "${POSTGRES_USER:?POSTGRES_USER ausente em $ENV_FILE}"
: "${POSTGRES_DB:?POSTGRES_DB ausente em $ENV_FILE}"

echo "==> criando papéis em $POSTGRES_DB (via superusuário $POSTGRES_USER)"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL
-- Mesmos quatro papéis do doc 08 §3 / docker/postgres/init/01-roles.sql — nenhum com BYPASSRLS.
CREATE ROLE app_rw LOGIN PASSWORD '$APP_RW_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOBYPASSRLS;
CREATE ROLE app_migrator LOGIN PASSWORD '$APP_MIGRATOR_PASSWORD' NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOBYPASSRLS;
CREATE ROLE app_readonly LOGIN PASSWORD '$APP_READONLY_PASSWORD' NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOBYPASSRLS;
CREATE ROLE app_monitor LOGIN PASSWORD '$APP_MONITOR_PASSWORD' NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOBYPASSRLS;

ALTER SCHEMA public OWNER TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_rw, app_readonly;
GRANT CREATE ON SCHEMA public TO app_migrator;

ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO app_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_rw;

-- pg_monitor dá visão de estatística e nada de dado de aplicação (doc 18 §2) — um exporter
-- comprometido não vira caminho para a tabela de vendas de um cliente.
GRANT pg_monitor TO app_monitor;
SQL

echo "==> papéis criados. Confira que DATABASE_URL/DATABASE_URL_MIGRATOR/POSTGRES_EXPORTER_DSN"
echo "    em $ENV_FILE usam estas MESMAS senhas — nada aqui as lê de volta."
echo "    Próximo passo: ./scripts/deploy.sh (doc 19 §6) para migrar e subir os serviços."
