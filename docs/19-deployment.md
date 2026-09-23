# 19 — Manual de Implantação

> **Primeira vez subindo isto?** Comece pela §9 — ela parte do zero (VM vazia) até o mecanismo
> rodando, e diz exatamente o que já existe e o que falta hoje. §1–§8 são a referência de
> arquitetura e operação de rotina, e o resto do código do projeto cita estas seções por número
> (`doc 19 §3`, `§4`, `§7`...) — não renumere.
>
> **Usando Nginx Proxy Manager (ou outro proxy) no lugar do Caddy?** O roteiro específico é o
> [doc 35](35-deploy-vps-npm.md): o Caddy não sobe (`DEPLOY_EDGE=none`), o proxy entra na rede
> `dashsgs_app`, e há duas coisas que o Caddy fazia e o app não faz sozinho — bloquear
> `/metrics` e emitir HSTS no front.
>
> **Nunca fez um deploy antes?** O [doc 36](36-primeiro-deploy-iniciante.md) é o mesmo caminho do
> doc 35 escrito do zero, sem pressupor Docker, Linux ou linha de comando — cada passo diz o que
> faz, o que digitar e o que você deve ver.
>
> **E antes de qualquer coisa: isto não é o gate de produção.** O checklist de GA (doc 32) tem 19
> itens `[BLOQ]` abertos hoje, e a Q1 do doc 34 (HTTPS ou VPN obrigatório da SG) segue sem
> resposta — sem ela nenhum tenant com ERP em HTTP puro conecta em produção, por desenho
> (`ALLOW_INSECURE_ERP` é recusado fora de dev, §3). Este documento é a mecânica de deploy; "estar
> pronto para clientes reais" é o doc 32.

## 1. Ambientes

| Ambiente | Onde | Dados | Integração SG |
|---|---|---|---|
| development | Docker Compose local | sintéticos (seed, opt-in — doc 24) | mocks (fixtures) ou homologação SG |
| staging | VM dedicada (cópia de prod) | sintéticos | homologação SG (`sgps.sgsistemas.com.br:8201`) [DOCUMENTADO] |
| production | VM(s) dedicadas | reais | ERPs dos tenants (HTTPS/VPN) |

Mesma imagem promovida dev→staging→prod; diferenças só por variáveis (12-factor). Na prática
hoje, "produção" é uma **segunda cópia** de tudo que a §9 descreve — outra VM, outro
`.env.production`, outro domínio, outro workflow de deploy (§9.6.4) — não um ambiente com
mecânica diferente.

## 2. Topologia de produção (MVP)

```
Internet ──> [Cloudflare (opcional: WAF/CDN)] ──> VM app (Caddy :443)
   Caddy ──> web (Next.js, container)
         ──> api (NestJS, container)
   api/workers ──> postgres (container ou gerenciado*), redis (container)
   workers ──> ERPs dos tenants (egress allowlist)
   [obs] prometheus + alertmanager + grafana + loki + promtail + blackbox + exporters
         (mesma VM no MVP; docker/compose.observability.yml)
   postgres ──> object storage (WAL-G: base backup + WAL contínuo, outra região)
```
*[RECOMENDAÇÃO] Postgres gerenciado (RDS/Cloud SQL/Neon) assim que houver clientes pagantes —
backups/replicação sem custo operacional. Compose com volume + WAL-G é aceitável no MVP.

A stack de observabilidade sobe **no mesmo projeto** do compose de staging/produção, não como
projeto separado: o Prometheus precisa das redes internas para raspar API, worker, Postgres e
Redis, e subir apartado exigiria expor esses alvos — exatamente o que o Caddyfile impede.

```bash
pnpm obs:up   # docker compose -f docker/compose.staging.yml -f docker/compose.observability.yml up -d
```

Nada da stack publica porta pública. O Grafana escuta em `127.0.0.1` e o acesso é por túnel SSH
(detalhe em §9.7). O container do banco é o único com saída para a internet (rede
`backup_egress`), porque `archive_command` roda dentro dele — sem porta publicada e sem
compartilhar segmento com a borda (ADR-017).

## 3. Variáveis de ambiente (contrato validado por zod no boot — falha rápida)

O contrato completo, campo a campo com comando de geração ao lado, está em
[`.env.staging.example`](../.env.staging.example) (staging/produção) e
[`.env.example`](../.env.example) (dev) — ambos testados
(`apps/api/test/unit/env-example.spec.ts` e `env-staging-example.spec.ts`): não repito a lista
aqui porque duas cópias divergem, e "faltou uma variável no deploy" é caro de descobrir tarde.

Resumo do que existe (nomes exatos em `apps/api/src/config/env.schema.ts`, o único lugar do
código autorizado a ler `process.env` — lint bloqueia o resto):

```
# App
NODE_ENV, APP_URL, API_URL, PORT
SESSION_SECRET (32+ caract.), CSRF_SECRET, COOKIE_DOMAIN
# Anti-automação (login — doc 06)
TURNSTILE_SECRET_KEY (API)  # + TURNSTILE_SITE_KEY no ambiente do `web` — MESMO widget Cloudflare,
                            # os dois têm que vir do mesmo par (site key ≠ secret key de outro
                            # widget = todo login recusado, sem erro óbvio no log)
# Banco/Cache
DATABASE_URL (TLS), DATABASE_URL_MIGRATOR, REDIS_URL
# Cripto
MASTER_KEY_CURRENT (base64 32B exatos), MASTER_KEY_PREVIOUS (rotação), MASTER_KEY_VERSION
PII_PEPPER (16+ caract.)
# E-mail
SMTP_URL, MAIL_FROM
# Observabilidade
OTEL_EXPORTER_OTLP_ENDPOINT, SENTRY_DSN, METRICS_ENABLED
# Integração
SG_DEFAULT_MAX_RPS=4, SG_PAGE_SIZE=500, SG_PAGE_SIZE_MIN=50
SG_HTTP_TIMEOUT_MS=60000, SG_HEAVY_TIMEOUT_MS=180000
SG_VPN_CIDR=10.66.0.0/16 (aceita lista — runbook 22 §7), SG_API_PATH_PREFIX, SG_AUTH_HEADER_MODE
ALLOW_INSECURE_ERP=false, SG_MOCK=false  # produção recusa qualquer outro valor
# Sincronização (worker)
SYNC_CONCURRENCY=4, SYNC_SCHEDULER_ENABLED=true, WORKER_PORT=3002
# Flags
FEATURE_ERP_WRITE=false, FEATURE_CLIENT_MODULE=false
```

Segredos via SOPS/age (arquivos `.enc.env` no repo, chave fora) ou secret manager; nunca em
imagem/compose plano. `.env.staging`/`.env.production` na VM têm permissão `600` e nunca vão
para o Git (`.gitignore` bloqueia `.env.*` por padrão; só os `*.example` escapam).

O serviço `workers` (compose de staging/produção) roda a **mesma imagem da API** com
`node dist/worker.js`: sem servidor de API, com as filas BullMQ e o endpoint de métricas. Escalar
réplicas é seguro — os locks por (tenant, domínio) impedem execução dupla —, mas apenas um
processo deve subir com `SYNC_SCHEDULER_ENABLED=true`, senão as cadências são registradas em
duplicidade. `stop_grace_period: 60s` dá tempo de o job corrente terminar antes do SIGKILL.

Três acoplamentos que o schema não confere sozinho — errar aqui não dá erro de boot, dá erro de
conexão recusada em runtime, mais difícil de rastrear até o arquivo de ambiente:

1. **`REDIS_URL` e `REDIS_PASSWORD` são o mesmo segredo em dois formatos.** Um é lido pela
   aplicação (dentro de uma URL), o outro pelo container Redis (`--requirepass`, linha de
   comando). Nada compara os dois automaticamente — só o smoke test (§4) revela a divergência.
2. **`DATABASE_URL`/`DATABASE_URL_MIGRATOR`/`POSTGRES_EXPORTER_DSN` usam senhas de papéis que só
   existem depois de `scripts/provision-roles.sh`** (§9.5.4). Numa VM nova, essas três URLs apontam
   para papéis que ainda não foram criados — a migração falha até esse passo ser feito.
3. **`POSTGRES_USER`/`POSTGRES_PASSWORD` são o superusuário de bootstrap do container**, não
   `app_rw`/`app_migrator` — a aplicação nunca se conecta com essas credenciais; elas só servem
   para o Postgres inicializar o volume e para `provision-roles.sh` criar os papéis reais.

## 4. Procedimento de deploy (produção)

1. Release taggeada → CI publica imagem por digest + SBOM.
2. `deploy.sh <digest-api> <digest-web> [.env-file]`: pull → `docker compose up --exit-code-from
   api-migrate api-migrate` (job de migração com `DATABASE_URL_MIGRATOR`) → sobe `api`/`web`/
   `caddy` → smoke (`/healthz`, `/readyz`, `/api/v1/meta`, erro 404 padronizado). As quatro
   verificações são de rotas da **API**: numa topologia em que a API não tem endereço público
   (front como BFF atrás de proxy externo — doc 35 §3), use `SMOKE_BASE_URL=none` e confira pelo
   `(healthy)` do container.
3. Verificação pós-deploy 15 min (painel SLO — `DashSGS · SLO board`, uid `dashsgs-slo`);
   rollback: `deploy.sh <digest-anterior>`
   (migrações são expand/contract — compatíveis com N-1; doc 11 §3).
4. Janela: horário de baixo uso (13h–15h ou 22h+); nunca durante pico de manhã de sábado
   (varejo).
5. `workers` não é tocado pelo `deploy.sh` — de propósito, o job de sincronização é operado à
   parte (doc 14 §1: nunca deve competir pela mesma disciplina de rollout que a API HTTP). Suba a
   imagem nova manualmente quando o worker mudar, com o **mesmo digest** que você acabou de
   passar ao `deploy.sh` (ele não fica disponível no shell sozinho — §9.5.5):
   `API_IMAGE=<mesmo digest do deploy.sh> docker compose -f docker/compose.staging.yml
   --env-file .env.staging up -d --no-deps workers`.

`/readyz` (readiness — dependências ok, é o portão que o smoke e um eventual balanceador usam) e
`/healthz` (liveness) vêm de `apps/api/src/common/health/`; `/api/v1/meta` (versão/nome do
produto, sem nada sensível) é o que os smoke tests do deploy também conferem.

## 5. TLS e domínio

- Caddy com ACME automático; HSTS após validação; TLS 1.2+ apenas; OCSP stapling.
- `app.dashsgs.com.br` (web) e `api.dashsgs.com.br` (API) [exemplo]; cookies `__Host-`.

## 6. Migrations

- `prisma migrate deploy` somente via job de CI/CD (nunca dev na produção).
- Toda migração revisada em PR com plano de rollback; migrações destrutivas exigem release
  posterior (expand→contract).
- Backup automático imediatamente antes de migração (snapshot lógico rápido).

## 7. Provisionamento de tenant (produção)

1. Criar tenant + owner (convite) no painel platform-admin.
2. Owner cadastra conexão ERP (wizard) — exigências: HTTPS válido OU VPN provisionada
   (runbook 22 §7); teste automático; captura de rotas.
3. Backfill agendado (janela noturna); acompanhamento no painel.
4. Checklist de entrega: dashboards com 90 dias, alertas padrão ativos, usuários convidados.

## 8. Rollback e contingência

- App: redeploy do digest anterior (imutável).
- Banco: PITR (doc 20); migração ruim → restore + replay é último recurso, preferir fix-forward.
- Configuração: versionada em git; `git revert` + redeploy.
- Procedimento completo de DR no doc 20; runbooks no doc 22.

## 9. Do zero: subindo a primeira VM (guia completo)

As seções acima descrevem o mecanismo assumindo que ele já está rodando. Esta seção é o caminho
inverso — nenhuma VM existe ainda — e termina exatamente onde a §4 começa.

### 9.0 Estado atual do pipeline (verificado, 19/09/2026)

| Peça | Estado |
|---|---|
| `docker/Dockerfile.api`, `Dockerfile.web` | Existem, buildam (multi-stage, non-root, `tini`, healthcheck) |
| `docker/compose.staging.yml` | Existe, completo — caddy/web/api-migrate/api/workers/postgres/backup/redis |
| `scripts/deploy.sh`, `scripts/smoke.sh` | Existem, executáveis |
| `.github/workflows/deploy-staging.yml` | Existe — publica imagem, faz deploy por SSH, roda DAST |
| Job **"Publicar imagens (por digest) + SBOM"** | **Roda com sucesso a cada push em `main`.** As imagens já existem em `ghcr.io/edgarfn/dashsgs-{api,web}` por digest. |
| Job **"Deploy em staging"** | **Falha em 5 segundos, sempre — `error: missing server host`.** Nenhuma VM foi apontada ainda. Verificado nas últimas 9 execuções, 9/9 falhas, desde a criação do repositório. |
| Ambiente `staging` no GitHub | Existe (criado junto com o repo), **sem nenhum secret/variável configurado** — `STAGING_HOST`, `STAGING_USER`, `STAGING_SSH_KEY`, `APP_DOMAIN`, `API_DOMAIN` estão todos vazios. |
| `docker/postgres/init/01-roles.sql` | Só roda em DEV (script de inicialização de volume); `compose.staging.yml` não monta nenhum init script — de propósito, os papéis de produção levam senha de cofre, não a `dev_only_password` fixa do arquivo de dev. `scripts/provision-roles.sh` (§9.5.4) é o passo que faltava para isso. |
| Workflow de **produção** | **Não existe.** Só `deploy-staging.yml`. Ver §9.6.4 para como criar um. |
| Visibilidade das imagens GHCR | O repositório está privado desde 19/09/2026; pacotes publicados por um repo privado nascem privados por padrão. **Presuma que `docker compose pull` na VM vai exigir `docker login ghcr.io`** (§9.3) até confirmar o contrário nas configurações do pacote no GitHub. |

Ou seja: a metade "CI constrói e publica a imagem" funciona hoje, sem tocar em nada. A metade
"alguém recebe essa imagem e sobe" nunca rodou — é o que o resto desta seção cobre, pela
primeira vez, do zero.

### 9.1 Pré-requisitos: a VM

- Linux com suporte a Docker (Ubuntu 22.04/24.04 LTS é o caminho testado pela comunidade Docker).
- Mínimo razoável para o MVP com um punhado de tenants: 2 vCPU / 4 GB RAM / 40 GB disco SSD.
  Observabilidade (Prometheus+Loki+Grafana) e o banco competem por disco — se crescer, o banco
  sai primeiro para gerenciado (§2).
- Acesso root ou sudo para instalar Docker e configurar firewall.
- IP público fixo (ou DNS dinâmico) — os dois domínios (§9.2) apontam para ele.

Hardening mínimo antes de expor qualquer porta (doc 09 §1 "Infraestrutura"):

```bash
# Firewall default-deny, só 22/80/443 (SSH, e o que o Caddy precisa)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# SSH só por chave — desligar senha
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# fail2ban no serviço SSH
sudo apt-get install -y fail2ban
sudo systemctl enable --now fail2ban

# Docker Engine + plugin compose (script oficial; revise antes de rodar em produção real)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # logout/login para valer
```

Confirme que **nenhuma outra porta** ficou aberta — nem 5432/6379 (Postgres/Redis já não têm
`ports:` publicado no compose, então isto é defesa em profundidade, não o único controle) nem a
porta do Grafana (§9.7, também sem `ports:` publicado — o acesso é por túnel).

### 9.2 Pré-requisitos: DNS

Dois registros `A` (ou `AAAA`), apontando para o IP da VM:

```
app.exemplo.com.br   A   <IP da VM>
api.exemplo.com.br   A   <IP da VM>
```

O Caddy (§2, §5) emite certificado ACME automaticamente para os dois assim que resolverem — não
precisa de passo manual de certificado.

### 9.3 Pré-requisitos: acesso às imagens (GHCR)

Como o repositório está privado (§9.0), a VM precisa de credencial para `docker pull`:

```bash
# Um Personal Access Token com escopo read:packages, gerado numa conta com acesso ao repo
echo "$GHCR_PAT" | docker login ghcr.io -u <usuario-github> --password-stdin
```

Faça isso uma vez, manualmente, na primeira configuração da VM — o `docker login` persiste a
credencial em `~/.docker/config.json`. Se preferir não guardar isso na VM, a alternativa é tornar
os pacotes GHCR públicos (Settings do pacote, em github.com/users/edgarfn/packages) — como as
imagens não contêm segredo nenhum (Dockerfile não copia `.env`), isso é seguro, só reduz uma
camada de controle de acesso.

### 9.4 Pré-requisitos: bucket para o WAL-G (backup contínuo)

Um bucket S3-compatível (AWS S3, MinIO, Backblaze B2, etc.), em **região/provedor diferente** da
VM — backup no mesmo lugar que o banco não sobrevive ao incidente que o banco não sobrevive
(doc 20 §1). Com object-lock ligado, se o provedor suportar (defesa contra ransomware que também
apaga backup). Anote endpoint, região, e crie uma chave de acesso com permissão restrita àquele
bucket — vira `WALG_*` em `.env.staging`.

### 9.5 Passo a passo, do zero

Assume a VM pronta (9.1–9.4), com Docker instalado e `docker login ghcr.io` feito.

**9.5.1 Clonar o repositório**

```bash
sudo mkdir -p /opt/dashsgs && sudo chown "$USER" /opt/dashsgs
git clone https://github.com/edgarfn/dashsgs.git /opt/dashsgs
cd /opt/dashsgs
```

`/opt/dashsgs` é o caminho que o script de deploy do workflow espera (`cd /opt/dashsgs`, dentro
de `.github/workflows/deploy-staging.yml`, §9.6.2) — usar outro exige editar o workflow.

**9.5.2 Construir e preencher `.env.staging`**

```bash
cp .env.staging.example .env.staging
chmod 600 .env.staging
```

Gere cada segredo com os comandos comentados no próprio arquivo (`openssl rand -base64 ...` /
`-hex ...`) e edite `.env.staging`. Confirme os cinco campos que a guarda de produção verifica
antes de seguir:

```bash
grep -E '^(SESSION_SECRET|CSRF_SECRET|PII_PEPPER|MASTER_KEY_CURRENT|TURNSTILE_SECRET_KEY)=' .env.staging
# nenhuma linha deve conter CHANGE_ME
```

`TURNSTILE_SECRET_KEY` vem do painel Cloudflare (Turnstile → Add widget, hostname = `APP_DOMAIN`)
— junto com ela sai uma site key, que vai na linha `TURNSTILE_SITE_KEY`, mais abaixo no mesmo
`.env.staging` (seção Frontend). As duas são do MESMO widget; a diferença é só que o compose só
repassa `TURNSTILE_SITE_KEY` para dentro do container `web` — a API nunca a recebe nem precisa
dela.

**9.5.3 Construir a imagem do Postgres (não vem do GHCR)**

Diferente de `api`/`web`, a imagem do Postgres com WAL-G embutido (`docker/postgres/Dockerfile`)
**não** é publicada pelo CI — é construída localmente, porque não muda a cada release do produto.

Os comandos `docker compose` daqui em diante **não** precisam de `API_IMAGE`/`WEB_IMAGE`/
`APP_VERSION` — o compose tem um valor-placeholder de fallback para os três justamente para que
comandos como este, que não tocam `api`/`web`/`workers`, funcionem sem eles. Sem esse fallback, o
Compose recusa o arquivo inteiro com `invalid compose project` mesmo pedindo só `postgres`,
porque valida todos os serviços antes de filtrar os pedidos — é o erro que aparece se você rodar
isto contra uma cópia mais antiga do repositório.

```bash
docker compose -f docker/compose.staging.yml --env-file .env.staging build postgres backup
```

Refaça este passo sempre que `docker/postgres/Dockerfile` ou `scripts/backup/*.sh` mudar — o
`deploy.sh` de rotina (§4) não reconstrói isto sozinho.

**9.5.4 Subir o banco e criar os papéis**

```bash
docker compose -f docker/compose.staging.yml --env-file .env.staging up -d postgres
# aguarde o healthcheck — `docker compose ... ps` mostra "healthy"

APP_RW_PASSWORD='<a mesma senha que está em DATABASE_URL>' \
APP_MIGRATOR_PASSWORD='<a mesma senha que está em DATABASE_URL_MIGRATOR>' \
APP_READONLY_PASSWORD='<gere uma nova — nada em .env.staging usa este papel ainda>' \
APP_MONITOR_PASSWORD='<a mesma senha que está em POSTGRES_EXPORTER_DSN>' \
./scripts/provision-roles.sh .env.staging
```

Este passo só existe uma vez por banco — rodar de novo falha em `CREATE ROLE` (papel já existe),
e é o sinal certo de "já fiz isto aqui", não um bug. É o passo que o comentário de
`docker/postgres/init/01-roles.sql` promete existir "no runbook 22" — agora existe, como script.

```bash
docker compose -f docker/compose.staging.yml --env-file .env.staging up -d redis
```

**9.5.5 Puxar `api`/`web` e rodar o primeiro deploy**

A partir daqui é exatamente a §4 — primeiro deploy ou centésimo, mesmo comando. Guarde o digest
numa variável de shell antes de chamar o script — você vai precisar dele de novo no passo
seguinte, e `deploy.sh` não deixa essa variável disponível depois que termina (o `export` de
dentro dele não sobe para o shell que o chamou):

```bash
# pegue os digests das imagens já publicadas (§9.0) no output do job "Publicar imagens", ou:
#   gh run view <run-id> --repo edgarfn/dashsgs --json jobs
API_IMAGE=ghcr.io/edgarfn/dashsgs-api@sha256:<digest>
WEB_IMAGE=ghcr.io/edgarfn/dashsgs-web@sha256:<digest>

./scripts/deploy.sh "$API_IMAGE" "$WEB_IMAGE" .env.staging
```

Se o smoke falhar, `deploy.sh` diz qual verificação e `docker compose logs <serviço>` explica o
resto — normalmente um dos três acoplamentos da §3.

Depois, suba o worker (fora do `deploy.sh` de propósito, §4 passo 5) e a observabilidade/backup.
`workers` usa a mesma imagem da API — reaproveite `$API_IMAGE`; sem ela, o comando cairia no
placeholder do compose (§9.5.3) e falharia por imagem inexistente:

```bash
API_IMAGE="$API_IMAGE" docker compose -f docker/compose.staging.yml --env-file .env.staging \
  up -d --no-deps workers
pnpm obs:up
docker compose -f docker/compose.staging.yml --env-file .env.staging up -d backup

# confirme o primeiro backup manualmente antes de confiar no agendador (runbook 22 §14)
docker compose -f docker/compose.staging.yml --env-file .env.staging exec backup \
  /opt/dashsgs/backup/backup.sh
```

### 9.6 Configurando o deploy contínuo (GitHub Actions)

Só depois que 9.5 funcionou manualmente uma vez — validar o mecanismo com as mãos antes de
confiar o SSH a um workflow automático.

**9.6.1 Chave SSH dedicada ao deploy**

```bash
ssh-keygen -t ed25519 -f deploy_key -N "" -C "dashsgs-deploy-staging"
# copie deploy_key.pub para ~/.ssh/authorized_keys do usuário de deploy NA VM
```

Considere um usuário de deploy apartado (não o seu próprio), no grupo `docker`, sem `sudo` —
least privilege: quem tem essa chave sobe/derruba containers, e nada além disso.

**9.6.2 Secrets e variáveis do ambiente `staging` no GitHub**

```bash
gh secret set STAGING_HOST --env staging --repo edgarfn/dashsgs        # IP ou hostname da VM
gh secret set STAGING_USER --env staging --repo edgarfn/dashsgs        # usuário de deploy
gh secret set STAGING_SSH_KEY --env staging --repo edgarfn/dashsgs < deploy_key  # a chave PRIVADA
gh variable set APP_DOMAIN --env staging --repo edgarfn/dashsgs        # app.exemplo.com.br
gh variable set API_DOMAIN --env staging --repo edgarfn/dashsgs        # api.exemplo.com.br
```

Sem os cinco, o job "Deploy em staging" continua falhando exatamente como em §9.0 — são esses
cinco valores, e nenhum outro, que faltam hoje.

**9.6.3 Disparar**

```bash
git push origin main   # dispara sozinho, ou:
gh workflow run deploy-staging.yml --repo edgarfn/dashsgs
```

Acompanhe com `gh run watch --repo edgarfn/dashsgs`. O job de DAST (ZAP baseline) só roda depois
do deploy ter sucesso, e um alerta *High* nele bloqueia a promoção para produção (doc 11 §2) — é
um gate, não um relatório informativo para ignorar.

**9.6.4 Quando existir uma VM de produção separada**

Não existe hoje. Para criar, o caminho natural (mesma mecânica, ambiente novo):

1. Repita 9.1–9.5 numa VM **diferente**, com domínios de produção.
2. `cp .github/workflows/deploy-staging.yml .github/workflows/deploy-production.yml`, trocando
   `staging` por `production` nos nomes de ambiente/secrets.

   **Atenção — o arquivo de ambiente continua se chamando `.env.staging`, mesmo em produção.**
   `docker/compose.staging.yml` traz `env_file: [../.env.staging]` *fixo* em três serviços
   (`api-migrate`, `api`, `workers`), e isso é o que os containers de fato leem. O argumento
   `[env-file]` do `deploy.sh` alimenta só a interpolação de `${VAR}` no YAML — são dois
   mecanismos diferentes. Verificado empiricamente: passando `--env-file .env.staging.example`
   com um `.env.staging` de conteúdo distinto ao lado, os três serviços receberam o valor do
   `.env.staging`. Renomear o arquivo sem editar as três linhas do compose faz o deploy subir
   com a configuração errada, ou falhar por arquivo ausente.
3. No ambiente `production` do GitHub (Settings → Environments → New environment), ligue
   **required reviewers** — é o botão de aprovação manual antes de qualquer deploy em produção
   tocar clientes de verdade, e o GitHub já faz isso nativamente, sem escrever nada a mais.
4. Gatilho por `on: workflow_dispatch` (manual) em vez de `push: [main]`, ou por uma tag de
   release — produção não deveria subir sozinha a cada commit em `main` do jeito que staging sobe.

### 9.7 Acessando o Grafana (sem porta pública)

```bash
ssh -N -L 3000:127.0.0.1:3000 <usuario>@<IP da VM>
# abra http://localhost:3000 no seu navegador
```

Credenciais: `GRAFANA_ADMIN_USER`/`GRAFANA_ADMIN_PASSWORD` de `.env.staging`. Troque a senha no
primeiro acesso — o admin criado pelo compose usa exatamente o que está no arquivo.
