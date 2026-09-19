# 35 — Roteiro: deploy em VPS com Nginx Proxy Manager

Para: VPS Linux com acesso root/SSH, Docker instalado, e **Nginx Proxy Manager já rodando em
container no mesmo host**. É a variante do doc 19 §9 em que o NPM ocupa o lugar do Caddy.

Tudo aqui foi conferido contra este repositório em 19/09/2026 — os comandos saem do
`docker/compose.staging.yml`, do `scripts/deploy.sh` e do código, não de suposição. Onde algo
depende de informação que só você tem (domínio, nome do container do NPM), está marcado.

> Isto é mecânica de deploy, não o gate de produção: o doc 32 tem 19 itens `[BLOQ]` abertos e a
> Q1 do doc 34 segue sem resposta (doc 19, nota do topo).

## 1. O que muda em relação ao doc 19

O compose traz um serviço `caddy` que publica 80/443. Com o NPM já ocupando essas portas, os
dois brigariam — então o Caddy **não sobe**. Nada no compose depende dele (conferido:
`depends_on` nenhum aponta para `caddy`), então pular é seguro.

Mas o Caddy fazia cinco coisas. Onde cada uma vai parar:

| O que o Caddy fazia | Com NPM |
|---|---|
| TLS/ACME (certificado) | NPM faz, na aba SSL (§5.7) |
| Cabeçalhos de segurança | **Já vêm do próprio app** — Helmet na API, `headers()` no `next.config.mjs`, CSP com nonce no `middleware.ts`. Sobrevivem sem o Caddy. |
| `Strict-Transport-Security` | **Exceção: o web NÃO define HSTS** (conferido — só a API define, via Helmet, e só em produção). Precisa ligar HSTS no NPM (§5.7). |
| Bloquear `/metrics` | **Não é replicado por nada.** `/metrics` é `@Public()` e o comentário do próprio controller diz que em produção "só é alcançável pela rede interna — o Caddy não publica `/metrics`". Ver §3 e §5.8. |
| `encode zstd gzip`, remover header `Server` | Perda cosmética/performance. Nginx comprime por padrão; o header `Server: nginx` passa a aparecer. |

## 2. Rede: como o NPM alcança os containers

Conferido com `docker compose config`: **só o `caddy` publica porta**. `web`, `api`, `postgres`,
`redis` e `workers` não publicam nada — existem apenas nas redes internas do compose.

Ou seja, não adianta apontar o NPM para `localhost:3000`: não há nada escutando ali. O caminho
certo é colocar o NPM **dentro da rede do DashSGS** e falar com os serviços pelo nome:

- rede: `dashsgs_app` (o compose declara `name: dashsgs`, então a rede `app` vira `dashsgs_app`)
- `web:3000` — o front
- `api:3001` — a API

É a opção mais segura das disponíveis: nenhuma porta da aplicação fica exposta no host, nem para
`127.0.0.1`.

## 3. Decisão antes de começar: um proxy host ou dois?

**Você provavelmente só precisa de um.**

Conferido no código: o front é BFF puro. Não existe nenhuma `NEXT_PUBLIC_*` com URL de API, o
módulo que lê `INTERNAL_API_URL` é `server-only`, e **nenhum componente `'use client'` faz
`fetch`** — a busca não achou um sequer. O navegador fala só com o Next; o Next fala com a API
pela rede interna. A API não precisa de DNS público para o produto funcionar.

| Opção | Quando | Consequência |
|---|---|---|
| **Só `app.seudominio`** (recomendado) | O normal | Menor superfície. O problema do `/metrics` deixa de existir, porque a API não fica pública. |
| `app` + `api.seudominio` | Se quiser o smoke externo do CI (`deploy-staging.yml` roda `smoke.sh` contra `https://${API_DOMAIN}`) | **Obrigatório** bloquear `/metrics` no NPM (§5.8), senão as métricas do Prometheus ficam abertas na internet, sem autenticação. |

O roteiro abaixo monta o caso de um host e mostra, em §5.8, o que acrescentar se você optar pelos dois.

## 4. Pré-requisitos

1. VPS com Docker e Docker Compose v2, firewall liberando só 22/80/443 — passo a passo de
   hardening no doc 19 §9.1.
2. NPM rodando em container no mesmo host.
3. DNS: um registro `A` de `app.seudominio.com.br` apontando para o IP da VPS. (Um segundo para
   `api.` só se você escolheu dois hosts em §3.)
4. Bucket S3-compatível para o WAL-G — doc 19 §9.4.
5. Acesso ao GHCR: o repositório é privado, então a VPS precisa de `docker login ghcr.io` com um
   PAT de escopo `read:packages` — doc 19 §9.3.

## 5. Passo a passo

### 5.1 Clonar

```bash
sudo mkdir -p /opt/dashsgs && sudo chown "$USER" /opt/dashsgs
git clone https://github.com/edgarfn/dashsgs.git /opt/dashsgs
cd /opt/dashsgs
```

### 5.2 Criar o `.env.staging`

**O nome do arquivo não é opcional.** `docker/compose.staging.yml` traz `env_file:
[../.env.staging]` fixo em três serviços (`api-migrate`, `api`, `workers`) — é esse arquivo que
os containers leem, mesmo em produção, mesmo que você passe outro caminho para o `deploy.sh`
(o argumento dele alimenta só a interpolação de `${VAR}` no YAML; são dois mecanismos
diferentes, verificado empiricamente).

```bash
cp .env.staging.example .env.staging
chmod 600 .env.staging
```

Edite e preencha cada `CHANGE_ME`. Os comandos de geração estão comentados ao lado de cada
campo no próprio arquivo. Para este roteiro, os valores que importam:

```bash
NODE_ENV=production
APP_URL=https://app.seudominio.com.br     # o domínio do NPM; precisa de https:// e bater exato
API_URL=https://api.seudominio.com.br     # mesmo se você não expuser a API, mantenha https://
COOKIE_DOMAIN=app.seudominio.com.br
INTERNAL_API_URL=http://api:3001          # rede interna — não mude
```

`APP_URL` é o `origin` do CORS da API (conferido em `main.ts`) — se não bater com o domínio que
o NPM serve, as chamadas do front falham. E `APP_URL`/`API_URL` sem `https://` fazem o boot
**recusar** em produção, por desenho.

### 5.3 Construir a imagem do Postgres

Ela não vem do GHCR (o CI publica só `api` e `web`):

```bash
docker compose -f docker/compose.staging.yml --env-file .env.staging build postgres backup
```

Este comando não precisa de `API_IMAGE`/`WEB_IMAGE`/`APP_VERSION` — o compose tem um
valor-placeholder de fallback para os três, exatamente para que comandos que não tocam
`api`/`web`/`workers` funcionem sem eles (sem isso, `docker compose` recusa o arquivo inteiro com
`invalid compose project`, mesmo pedindo só `postgres`/`backup`, porque valida todos os serviços
antes de filtrar o que foi pedido).

### 5.4 Subir o banco e criar os papéis

```bash
docker compose -f docker/compose.staging.yml --env-file .env.staging up -d postgres
docker compose -f docker/compose.staging.yml --env-file .env.staging ps   # aguarde "healthy"

APP_RW_PASSWORD='<a mesma senha de DATABASE_URL>' \
APP_MIGRATOR_PASSWORD='<a mesma senha de DATABASE_URL_MIGRATOR>' \
APP_READONLY_PASSWORD='<gere uma>' \
APP_MONITOR_PASSWORD='<a mesma senha de POSTGRES_EXPORTER_DSN>' \
./scripts/provision-roles.sh .env.staging

docker compose -f docker/compose.staging.yml --env-file .env.staging up -d redis
```

Sem este passo a migração falha: `app_migrator` não existe num Postgres recém-criado, porque o
`01-roles.sql` só roda em desenvolvimento (doc 19 §9.5.4 / runbook 22 §0).

### 5.5 Subir a aplicação, sem o Caddy

Pegue os digests no job "Publicar imagens" do último workflow verde:

```bash
gh run list --workflow=deploy-staging.yml --repo edgarfn/dashsgs --limit 1
```

E rode o deploy com a borda desligada. Guarde o digest da API numa variável — você precisa dele
de novo logo abaixo, e `deploy.sh` não deixa essa variável disponível depois que termina (o
`export` de dentro do script não sobe para o shell que o chamou):

```bash
API_IMAGE=ghcr.io/edgarfn/dashsgs-api@sha256:<digest-api>
WEB_IMAGE=ghcr.io/edgarfn/dashsgs-web@sha256:<digest-web>

DEPLOY_EDGE=none \
SMOKE_BASE_URL=https://app.seudominio.com.br \
./scripts/deploy.sh "$API_IMAGE" "$WEB_IMAGE" .env.staging
```

Duas variáveis de ambiente do `deploy.sh`, dois motivos concretos:

- `DEPLOY_EDGE=none` — sem isso o script sobe o `caddy` junto e ele bate de frente com o NPM na
  porta 80/443.
- `SMOKE_BASE_URL` — o padrão do script é `http://localhost:3001`, que **não funciona neste
  compose**: nada publica 3001 no host. Na primeira execução o NPM ainda não está configurado,
  então o smoke vai falhar aqui; siga para §5.6 e rode o smoke de novo depois (§6).

Depois, o worker (fica fora do `deploy.sh` de propósito — doc 19 §4 passo 5). Ele usa a mesma
imagem da API — reaproveite `$API_IMAGE`; sem ela, o compose cairia no valor-placeholder de
fallback (§5.3) e falharia por imagem inexistente:

```bash
API_IMAGE="$API_IMAGE" docker compose -f docker/compose.staging.yml --env-file .env.staging \
  up -d --no-deps workers
```

### 5.6 Ligar o NPM à rede do DashSGS

Descubra o nome do container do NPM:

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i nginx-proxy-manager
```

Conecte-o à rede da aplicação:

```bash
docker network connect dashsgs_app <nome-do-container-do-npm>
```

Confirme que o NPM enxerga os serviços pelo nome:

```bash
docker exec <nome-do-container-do-npm> getent hosts web api
```

Devem sair dois IPs da rede `dashsgs_app`. Se não saírem, o NPM não entrou na rede.

**Torne isso durável.** Um `docker network connect` manual se perde quando o container do NPM é
recriado (em qualquer `docker compose up -d` da stack dele). Declare a rede no compose do
próprio NPM:

```yaml
services:
  app: # ou o nome que o serviço do NPM tem no seu compose
    networks: [default, dashsgs_app]

networks:
  dashsgs_app:
    external: true
```

### 5.7 Criar o proxy host no NPM

Na interface do NPM → **Hosts → Proxy Hosts → Add Proxy Host**.

Aba **Details**:

| Campo | Valor |
|---|---|
| Domain Names | `app.seudominio.com.br` |
| Scheme | `http` |
| Forward Hostname / IP | `web` |
| Forward Port | `3000` |
| Block Common Exploits | ligado |
| Websockets Support | pode ligar; inofensivo |

`http` no Scheme está certo: o TLS termina no NPM, e dali para o container o tráfego anda dentro
da rede Docker.

Aba **SSL**:

| Campo | Valor |
|---|---|
| SSL Certificate | Request a new SSL Certificate (Let's Encrypt) |
| Force SSL | ligado |
| HTTP/2 Support | ligado |
| **HSTS Enabled** | **ligado** |
| Email / termos | seu e-mail, aceitar |

O HSTS não é detalhe: conferido no código, o front **não** emite `Strict-Transport-Security`
sozinho — quem emitia era o Caddy. Sem marcar essa caixa, o app perde HSTS em relação à
topologia original.

### 5.8 Só se você expuser a API publicamente

Se optou pelos dois hosts (§3), crie o segundo com `api.seudominio.com.br` → `api` : `3001`,
mesma configuração de SSL — **e bloqueie `/metrics`** na aba **Advanced** desse host:

```nginx
location /metrics {
    return 404;
}
```

Sem isso, `https://api.seudominio.com.br/metrics` devolve as métricas do Prometheus para
qualquer um: o endpoint é `@Public()`, sem autenticação, e no desenho original quem o escondia
era a regra `respond @metrics 404` do Caddyfile.

`/healthz` e `/readyz` ficam públicos de propósito — o Caddy também os deixava, e o smoke
externo do CI depende deles.

## 6. Verificação

```bash
# 1. a aplicação responde pelo domínio, com certificado válido
curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://app.seudominio.com.br/

# 2. HSTS presente (só aparece se você marcou a caixa em §5.7)
curl -sSI https://app.seudominio.com.br/ | grep -i strict-transport-security

# 3. o smoke do projeto, agora pela URL pública
./scripts/smoke.sh https://app.seudominio.com.br
```

O `smoke.sh` confere `/healthz`, `/readyz`, `/api/v1/meta` e o formato do erro 404 — mas essas
rotas são da **API**. Se você expôs só o front (§3), aponte o smoke para o host da API apenas
quando ele existir; caso contrário, valide pelo navegador e pelos logs:

```bash
docker compose -f docker/compose.staging.yml --env-file .env.staging logs -f api web
```

E, se expôs a API, confirme que o bloqueio pegou:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://api.seudominio.com.br/metrics   # 404
```

## 7. Armadilhas verificadas neste repositório

Todas confirmadas na prática, não deduzidas:

1. **`deploy.sh` subia o Caddy sempre.** Resolvido com `DEPLOY_EDGE=none`. A opção é variável de
   ambiente, e não edição do script, porque o workflow de deploy roda `git checkout --force` na
   VM — qualquer alteração local em arquivo versionado é apagada no deploy seguinte.
2. **O smoke padrão aponta para `localhost:3001`, que nunca funcionou nesta topologia.** Nenhum
   serviço publica 3001; só o Caddy publicava porta. Use `SMOKE_BASE_URL`.
3. **O arquivo precisa se chamar `.env.staging`.** O `env_file:` está fixo no compose, em três
   serviços. Renomear sem editar o compose sobe a aplicação com a configuração errada.
4. **`/metrics` é público sem o Caddy.** §5.8.
5. **O front não emite HSTS.** §5.7.
6. **`trust proxy` está fixo em 1 salto** (`app.set('trust proxy', 1)` no `main.ts`). O NPM é
   esse salto. Se você puser Cloudflare ou outro proxy na frente do NPM, o IP registrado no rate
   limit e na auditoria passa a ser o do proxy, não o do cliente.

## 8. Deploy de rotina, depois disso

```bash
cd /opt/dashsgs && git pull
DEPLOY_EDGE=none SMOKE_BASE_URL=https://app.seudominio.com.br \
  ./scripts/deploy.sh <digest-api-novo> <digest-web-novo> .env.staging
```

Rollback é o mesmo comando com os digests anteriores — a imagem é imutável (doc 19 §8). Se o
worker também mudou, suba-o com o mesmo digest logo em seguida, do jeito mostrado em §5.5.

Se for automatizar pelo GitHub Actions, os cinco secrets/variáveis do ambiente `staging` estão
em doc 19 §9.6.2 — e o script SSH do workflow precisa levar `DEPLOY_EDGE=none` junto, senão o
deploy automático volta a subir o Caddy.
