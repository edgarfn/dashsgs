#!/usr/bin/env bash
# DashSGS — gera o .env.staging com todas as senhas já preenchidas e coerentes (doc 36).
#
#   ./scripts/gerar-env.sh app.meudominio.com.br [api.meudominio.com.br]
#
# Por que existe: preencher esse arquivo à mão erra fácil. Três valores aparecem em MAIS DE UM
# lugar e precisam bater exatamente (doc 19 §3) — a senha do Redis vai em `REDIS_PASSWORD` e
# dentro de `REDIS_URL`; a do app_rw vai em `DATABASE_URL`; a do app_monitor em
# `POSTGRES_EXPORTER_DSN`. Nada no sistema confere se bateram: o sintoma é "conexão recusada"
# horas depois, longe da causa. Aqui elas nascem de uma fonte só.
#
# O arquivo é montado a partir do .env.staging.example, linha por linha — comentários e ordem
# são preservados, e campo novo que aparecer lá no futuro vem junto automaticamente.
set -Eeuo pipefail

APP_DOMAIN="${1:-}"
API_DOMAIN="${2:-}"

if [[ -z "$APP_DOMAIN" ]]; then
  cat >&2 <<'AJUDA'
uso: ./scripts/gerar-env.sh <dominio-do-app> [dominio-da-api]

  exemplo:  ./scripts/gerar-env.sh app.minhaempresa.com.br

O domínio da API é OPCIONAL: o navegador nunca fala com a API diretamente (o front é quem
conversa com ela, por dentro do servidor). Só informe o segundo se você tiver um motivo para
publicar a API na internet — doc 35 §3.
AJUDA
  exit 2
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXEMPLO="$RAIZ/.env.staging.example"
DESTINO="$RAIZ/.env.staging"

[[ -f "$EXEMPLO" ]] || { echo "não achei $EXEMPLO" >&2; exit 1; }

if [[ -e "$DESTINO" ]]; then
  echo "ERRO: $DESTINO já existe." >&2
  echo "      Não vou sobrescrever: se o sistema já subiu com essas senhas, trocá-las agora" >&2
  echo "      quebraria o acesso ao banco. Apague o arquivo à mão se tiver certeza." >&2
  exit 1
fi

command -v openssl >/dev/null || { echo "openssl não encontrado — instale-o antes" >&2; exit 1; }

# hex (não base64) para tudo que entra dentro de uma URL: base64 usa + / =, que precisariam de
# escape em `postgresql://...` e em arquivo de ambiente. hex é [0-9a-f], nunca precisa.
senha_url()  { openssl rand -hex 24; }
segredo()    { openssl rand -base64 48 | tr -d '\n'; }
chave32()    { openssl rand -base64 32 | tr -d '\n'; }   # 32 bytes EXATOS, exigência do schema

SENHA_POSTGRES="$(senha_url)"
SENHA_APP_RW="$(senha_url)"
SENHA_APP_MIGRATOR="$(senha_url)"
SENHA_APP_READONLY="$(senha_url)"
SENHA_APP_MONITOR="$(senha_url)"
SENHA_REDIS="$(senha_url)"
SENHA_GRAFANA="$(senha_url)"

BANCO="dashsgs"

declare -A VALOR=(
  [APP_URL]="https://$APP_DOMAIN"
  [API_URL]="https://${API_DOMAIN:-$APP_DOMAIN}"
  [COOKIE_DOMAIN]="$APP_DOMAIN"
  [APP_DOMAIN]="$APP_DOMAIN"
  [API_DOMAIN]="${API_DOMAIN:-$APP_DOMAIN}"

  [SESSION_SECRET]="$(segredo)"
  [CSRF_SECRET]="$(segredo)"
  [MASTER_KEY_CURRENT]="$(chave32)"
  [PII_PEPPER]="$(segredo)"

  [POSTGRES_PASSWORD]="$SENHA_POSTGRES"
  [REDIS_PASSWORD]="$SENHA_REDIS"
  [GRAFANA_ADMIN_PASSWORD]="$SENHA_GRAFANA"
  [WALG_LIBSODIUM_KEY]="$(openssl rand -hex 32)"

  # Os três acoplamentos: a senha aqui é a MESMA que o provision-roles.sh vai criar no banco.
  [DATABASE_URL]="postgresql://app_rw:$SENHA_APP_RW@postgres:5432/$BANCO?schema=public&sslmode=disable"
  [DATABASE_URL_MIGRATOR]="postgresql://app_migrator:$SENHA_APP_MIGRATOR@postgres:5432/$BANCO?schema=public&sslmode=disable"
  [POSTGRES_EXPORTER_DSN]="postgresql://app_monitor:$SENHA_APP_MONITOR@postgres:5432/$BANCO?sslmode=disable"
  [REDIS_URL]="redis://:$SENHA_REDIS@redis:6379"
)

umask 077
: > "$DESTINO"

while IFS= read -r linha || [[ -n "$linha" ]]; do
  if [[ "$linha" =~ ^([A-Z0-9_]+)= ]]; then
    chave="${BASH_REMATCH[1]}"
    if [[ -v VALOR["$chave"] ]]; then
      printf '%s=%s\n' "$chave" "${VALOR[$chave]}" >> "$DESTINO"
      continue
    fi
  fi
  printf '%s\n' "$linha" >> "$DESTINO"
done < "$EXEMPLO"

chmod 600 "$DESTINO"

echo "Pronto: $DESTINO criado, com permissão 600 (só o seu usuário lê)."
echo ""
echo "AINDA FALTA VOCÊ PREENCHER À MÃO, se for usar:"
# Só linhas de atribuição (`CHAVE=...`); o cabeçalho do arquivo fala de CHANGE_ME em comentário
# e apareceria aqui como se fosse pendência.
grep -nE '^[A-Z0-9_]+=.*CHANGE_ME' "$DESTINO" | sed 's/^/  linha /' ||
  echo "  (nada — todos os campos foram gerados)"
echo ""
echo "  · SMTP_*  — servidor de e-mail. Sem ele o sistema SOBE normalmente, mas convite de"
echo "              usuário e 'esqueci minha senha' não chegam a ninguém."
echo "  · WALG_*  — backup automático para nuvem (doc 20). Sem ele o sistema sobe e funciona,"
echo "              mas NÃO há backup. Não fique assim em produção de verdade."
echo "  · TURNSTILE_SECRET_KEY (API) + TURNSTILE_SITE_KEY (web, fora deste arquivo — ver doc 19"
echo "              §3) — captcha da tela de login (Cloudflare Turnstile). AO CONTRÁRIO dos"
echo "              dois acima, este NÃO é opcional: deixado como CHANGE_ME, a API RECUSA"
echo "              subir em produção. Crie o widget em dash.cloudflare.com → Turnstile, com"
echo "              hostname = o domínio do passo 5, e use as duas chaves que ele gerar (o"
echo "              site key e a secret key são do MESMO widget — não misture com outro)."
echo ""
echo "PRÓXIMO PASSO — crie os usuários do banco com estas senhas (copie o bloco inteiro):"
echo ""
cat <<COMANDO
APP_RW_PASSWORD='$SENHA_APP_RW' \\
APP_MIGRATOR_PASSWORD='$SENHA_APP_MIGRATOR' \\
APP_READONLY_PASSWORD='$SENHA_APP_READONLY' \\
APP_MONITOR_PASSWORD='$SENHA_APP_MONITOR' \\
./scripts/provision-roles.sh .env.staging
COMANDO
echo ""
echo "(Guarde este bloco num gerenciador de senhas. Ele não é exibido de novo.)"
