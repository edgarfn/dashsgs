# 36 — Primeiro deploy, do zero (guia para iniciantes)

Este guia leva você de um servidor vazio até o DashSGS funcionando na internet, com HTTPS. Cada
passo diz **o que faz**, **o que digitar** e **o que você deve ver** se deu certo.

Não é preciso saber Docker, Linux ou programação. É preciso saber **copiar e colar num terminal**
e **ler uma mensagem de erro até o fim**. Onde algo puder dar errado, o guia avisa antes.

**Tempo estimado:** 1 hora, se você já tiver o servidor e o domínio.

---

## Antes de começar: o que você precisa ter

| Item | O que é | Como saber se você tem |
|---|---|---|
| Um servidor Linux | Um computador na internet que fica ligado o tempo todo (chamam de VPS) | Você recebeu do provedor um endereço IP, um usuário (normalmente `root`) e uma senha ou chave |
| Um domínio | O endereço do site, tipo `app.suaempresa.com.br` | Você comprou num registrador (Registro.br, GoDaddy…) e consegue entrar no painel dele |
| Nginx Proxy Manager | Um programa que já deve estar rodando no seu servidor; é ele que entrega o site com HTTPS | Você acessa o painel dele pelo navegador |
| Acesso ao código | Uma conta no GitHub com permissão no repositório `edgarfn/dashsgs` | Você consegue abrir github.com/edgarfn/dashsgs logado |

Se faltar algum, pare aqui e resolva primeiro — nenhum passo adiante funciona sem eles.

---

## Mapa: o que vamos fazer

```
PREPARAR         1. Entrar no servidor
                 2. Conferir o Docker
                 3. Criar a chave de acesso ao GitHub
                 4. Baixar o código

CONFIGURAR       5. Apontar o domínio para o servidor
                 6. Gerar as senhas (um comando faz tudo)
                 7. Ligar o banco de dados e criar seus usuários

SUBIR            8. Autorizar o download das imagens
                 9. Subir a aplicação
                10. Subir o worker (o robô que sincroniza dados)

PUBLICAR        11. Ligar o proxy à aplicação
                12. Criar o site no Nginx Proxy Manager
                13. Ligar o HTTPS

CONFERIR        14. Testar se está tudo no ar
```

Antes de cada bloco de comandos, confira se você está **dentro do servidor** (passo 1) e **na
pasta certa** (passo 4). Quase todo erro de iniciante é um desses dois.

---

# PREPARAR

## Passo 1 — Entrar no servidor

**O que faz:** abre uma "janela de comandos" dentro do servidor, pela internet. Isso se chama
SSH. Tudo que você digitar dali em diante acontece no servidor, não no seu computador.

No seu computador, abra o terminal (no Windows: o app "Terminal" ou "PowerShell") e digite,
trocando pelos seus dados:

```bash
ssh root@SEU_IP_AQUI
```

**O que você deve ver:** ele pede a senha (ao digitar, não aparece nada na tela — é normal), e
depois o texto no início da linha muda para algo como `root@srv123456:~#`. Esse `#` no fim
significa que você está dentro do servidor.

---

## Passo 2 — Conferir o Docker

**O que faz:** o Docker é o programa que roda a aplicação em "caixas" isoladas, chamadas
containers. Vamos só conferir se ele está instalado.

```bash
docker --version
docker compose version
```

**O que você deve ver:** duas linhas com números de versão, tipo `Docker version 29.8.0` e
`Docker Compose version v5.5.1`.

**Se aparecer "command not found":** o Docker não está instalado. Instale com o comando abaixo e
repita a conferência:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

---

## Passo 3 — Criar a chave de acesso ao GitHub

**O que faz:** o código e a aplicação pronta ficam guardados no GitHub, num repositório privado.
O servidor precisa de uma chave (chamada *token*) para baixar os dois. Você cria uma só, agora, e
usa nos passos 4 e 8.

No seu navegador:

1. Entre em `github.com` → clique na sua foto (canto superior direito) → **Settings**
2. Desça até o fim do menu da esquerda → **Developer settings**
3. **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**
4. Em *Note*, escreva `servidor dashsgs`. Em *Expiration*, escolha `90 days`
5. Marque **duas** caixas:
   - `repo` — permite baixar o **código**
   - `read:packages` — permite baixar a **aplicação pronta**
6. Clique em **Generate token** e **copie o código que aparecer**

> ### ⚠️ Copie o token agora
>
> Ele aparece **uma única vez**. Se fechar a página sem copiar, terá que gerar outro. Cole num
> gerenciador de senhas ou num bloco de notas até terminar este guia.

---

## Passo 4 — Baixar o código

**O que faz:** copia o código do DashSGS para dentro do servidor, numa pasta.

```bash
sudo mkdir -p /opt/dashsgs
sudo chown "$USER" /opt/dashsgs
git clone https://github.com/edgarfn/dashsgs.git /opt/dashsgs
cd /opt/dashsgs
```

**Ele vai pedir login.** Digite seu usuário do GitHub e, quando pedir a senha, **cole o token do
passo 3** (não a senha da sua conta). Ao colar, nada aparece na tela — é normal.

**O que você deve ver:** várias linhas de download terminando em `done`, e o início da sua linha
de comando passa a mostrar `/opt/dashsgs`.

> **Importante:** todos os comandos deste guia, daqui em diante, precisam ser rodados **dentro
> desta pasta**. Se você sair dela (ou reconectar no servidor depois), volte com:
> `cd /opt/dashsgs`

---

# CONFIGURAR

## Passo 5 — Apontar o domínio para o servidor

**O que faz:** avisa a internet que `app.suaempresa.com.br` fica no seu servidor.

Entre no painel onde você comprou o domínio, procure "DNS" ou "Zona DNS", e crie um registro:

| Campo | Valor |
|---|---|
| Tipo | `A` |
| Nome / Host | `app` |
| Valor / Aponta para | o IP do seu servidor |
| TTL | deixe o padrão |

**Como conferir (de volta no servidor):**

```bash
ping -c 2 app.suaempresa.com.br
```

**O que você deve ver:** o IP do seu servidor aparecendo na resposta. Se aparecer "unknown host",
espere alguns minutos — o DNS demora para se espalhar — e tente de novo.

---

## Passo 6 — Gerar as senhas

**O que faz:** cria o arquivo de configuração com todas as senhas do sistema, geradas de forma
segura e aleatória.

Este é o passo que mais dá errado quando feito à mão: algumas senhas precisam aparecer em dois
ou três lugares diferentes, **exatamente iguais**, e nada no sistema avisa se você errou — o
problema só aparece horas depois, como "conexão recusada". Por isso existe um comando que faz
tudo de uma vez:

```bash
./scripts/gerar-env.sh app.suaempresa.com.br
```

**O que você deve ver:**

```
Pronto: /opt/dashsgs/.env.staging criado, com permissão 600 (só o seu usuário lê).

AINDA FALTA VOCÊ PREENCHER À MÃO, se for usar:
  linha 53:SMTP_URL=smtp://usuario:CHANGE_ME@smtp.exemplo.com.br:587
  linha 138:WALG_ACCESS_KEY_ID=CHANGE_ME
  ...

PRÓXIMO PASSO — crie os usuários do banco com estas senhas (copie o bloco inteiro):

APP_RW_PASSWORD='...' \
APP_MIGRATOR_PASSWORD='...' \
...
```

> ### ⚠️ Guarde o bloco final agora
>
> As senhas mostradas no fim **não aparecem de novo**. Copie aquele bloco inteiro e cole num
> gerenciador de senhas (ou num lugar seguro) antes de continuar. Você vai usá-lo no passo 7.

**Sobre os dois "CHANGE_ME" que sobraram:**

- `SMTP_*` — é o servidor de e-mail. O sistema **sobe normalmente sem ele**, mas convite de
  usuário e "esqueci minha senha" não chegam a ninguém. Dá para preencher depois.
- `WALG_*` — é o backup automático. O sistema **sobe normalmente sem ele**, mas não haverá
  backup. Para um teste, tudo bem; para uso de verdade, não fique assim.

---

## Passo 7 — Ligar o banco de dados e criar seus usuários

**O que faz:** o banco de dados é onde ficam guardadas as informações. São três comandos:
montar o programa do banco, ligá-lo, e criar dentro dele os usuários que a aplicação usa.

**7.1 — Montar o programa do banco** (demora alguns minutos na primeira vez):

```bash
docker compose -f docker/compose.staging.yml --env-file .env.staging build postgres backup
```

**O que você deve ver:** muitas linhas de download e, no fim, `Image dashsgs/postgres:17-walg
Built` (duas vezes).

**7.2 — Ligar o banco:**

```bash
docker compose -f docker/compose.staging.yml --env-file .env.staging up -d postgres
```

Agora confira se ele terminou de subir:

```bash
docker compose -f docker/compose.staging.yml --env-file .env.staging ps
```

**O que você deve ver:** uma linha do `postgres` com o status `Up` e a palavra **`(healthy)`**.

> **Na primeira vez isso demora cerca de 1 minuto** — o banco precisa criar seus arquivos
> internos antes de aceitar conexões. Enquanto isso, aparece `(health: starting)`. Não é erro:
> espere e rode o comando de novo até virar `(healthy)`. (Medido: 66 segundos numa máquina
> comum.) Se ficar `(unhealthy)`, aí sim vá para a seção "Se der errado", no fim do guia.

**7.3 — Criar os usuários do banco:** cole aqui aquele bloco que você guardou no passo 6. Ele
termina chamando o `provision-roles.sh`.

**O que você deve ver:** `==> papéis criados.` seguido de duas linhas de aviso sobre conferir as
senhas.

**Se aparecer `role "app_rw" already exists`:** você já rodou este passo antes. Pode seguir em
frente, está tudo certo.

**7.4 — Ligar o Redis** (uma memória rápida que a aplicação usa):

```bash
docker compose -f docker/compose.staging.yml --env-file .env.staging up -d redis
```

---

# SUBIR

## Passo 8 — Autorizar o download das imagens

**O que faz:** a aplicação pronta fica guardada no GitHub em pacotes chamados *imagens*. No
passo 4 você usou o token para baixar o **código**; agora ele autoriza baixar a **aplicação**.

```bash
docker login ghcr.io -u SEU_USUARIO_GITHUB
```

Quando pedir a senha, **cole o mesmo token do passo 3** (não a senha da sua conta). Ao colar,
nada aparece na tela — é normal. Aperte Enter.

**O que você deve ver:** `Login Succeeded`.

**Se der `unauthorized`:** o token provavelmente não tem a caixa `read:packages` marcada. Gere
outro (passo 3) com as duas caixas e repita.

---

## Passo 9 — Subir a aplicação

**O que faz:** baixa a versão mais recente da aplicação e a coloca no ar.

**9.1 — Descobrir qual versão baixar.** No seu navegador, abra:
`github.com/edgarfn/dashsgs/actions/workflows/deploy-staging.yml`

> **Não se assuste com o ❌ vermelho.** Hoje *todas* as execuções aparecem como falhadas na
> lista, porque a última etapa (deploy automático) ainda não está configurada — é justamente o
> que você está fazendo à mão aqui. A etapa que interessa, "Publicar imagens", está verde.

Clique na execução mais recente, depois no item **"Publicar imagens (por digest) + SBOM"** (deve
estar com ✅), e procure no meio do texto duas linhas parecidas com:

```
ghcr.io/edgarfn/dashsgs-api@sha256:0b4879a341e9...
ghcr.io/edgarfn/dashsgs-web@sha256:890a2b231d42...
```

Copie as duas.

**9.2 — Guardar as duas numa variável** (isso evita ter que colar tudo de novo no passo 10):

```bash
API_IMAGE=ghcr.io/edgarfn/dashsgs-api@sha256:COLE_AQUI
WEB_IMAGE=ghcr.io/edgarfn/dashsgs-web@sha256:COLE_AQUI
```

**9.3 — Subir:**

```bash
DEPLOY_EDGE=none \
SMOKE_BASE_URL=none \
./scripts/deploy.sh "$API_IMAGE" "$WEB_IMAGE" .env.staging
```

**O que você deve ver:** as etapas `==> puxando imagens`, `==> aplicando migrações`,
`==> subindo serviços`, depois `==> smoke PULADO` e, por fim, `==> deploy concluído`.

**O que significam as duas linhas extras:**

- `DEPLOY_EDGE=none` — o projeto vem com um programa próprio para entregar o site (o Caddy).
  Como você usa o Nginx Proxy Manager, os dois brigariam pela mesma porta. Isso desliga o Caddy.
- `SMOKE_BASE_URL=none` — desliga o autoteste final. Ele só funciona quando a API tem endereço
  público, e na sua montagem ela não tem (é o navegador que fala com o site, e o site é quem
  fala com a API, por dentro do servidor). A conferência equivalente é o passo 14.

---

## Passo 10 — Subir o worker

**O que faz:** o *worker* é o robô que busca os dados no ERP de tempos em tempos. Ele roda
separado da aplicação para não deixar o site lento.

```bash
API_IMAGE="$API_IMAGE" docker compose -f docker/compose.staging.yml --env-file .env.staging \
  up -d --no-deps workers
```

**O que você deve ver:** `Container dashsgs-workers-1  Started`.

**Se aparecer erro de imagem não encontrada:** você provavelmente abriu um terminal novo e perdeu
a variável do passo 9.2. Refaça o 9.2 e repita este passo.

---

# PUBLICAR NA INTERNET

## Passo 11 — Ligar o proxy à aplicação

**O que faz:** por segurança, a aplicação não fica exposta na internet — ela só aceita conexões
"de dentro". Este passo dá ao Nginx Proxy Manager uma porta de entrada para conversar com ela.

**11.1 — Descobrir o nome do container do proxy:**

```bash
docker ps --format '{{.Names}}' | grep -i nginx
```

**O que você deve ver:** um nome, tipo `nginx-proxy-manager-app-1`. Anote.

**11.2 — Conectar:**

```bash
docker network connect dashsgs_app NOME_QUE_VOCE_ANOTOU
```

**11.3 — Conferir se funcionou:**

```bash
docker exec NOME_QUE_VOCE_ANOTOU getent hosts web
```

**O que você deve ver:** uma linha com um número de IP e a palavra `web`. Se não aparecer nada, a
conexão não foi feita — repita o 10.2 conferindo o nome.

> **Para não perder isso depois:** essa ligação se desfaz se o Nginx Proxy Manager for
> reinstalado ou atualizado. A forma definitiva de resolver está no doc 35 §5.6 — peça ajuda de
> alguém técnico para aplicá-la quando puder.

---

## Passo 12 — Criar o site no Nginx Proxy Manager

**O que faz:** diz ao proxy "quando alguém pedir `app.suaempresa.com.br`, entregue a aplicação".

Abra o painel do Nginx Proxy Manager no navegador e vá em **Hosts → Proxy Hosts → Add Proxy
Host**. Na aba **Details**, preencha:

| Campo | O que colocar |
|---|---|
| Domain Names | `app.suaempresa.com.br` |
| Scheme | `http` |
| Forward Hostname / IP | `web` |
| Forward Port | `3000` |
| Block Common Exploits | ligado |

> **`http` está certo**, mesmo o site sendo seguro: a proteção (o "cadeado") é feita pelo proxy;
> daí para dentro do servidor o tráfego não sai para a internet.
>
> **`web` está certo**, não é um endereço de internet: é o nome da aplicação dentro da rede que
> você conectou no passo 11.

**Não clique em Save ainda** — vá para a aba SSL (passo 13).

---

## Passo 13 — Ligar o HTTPS (o cadeado)

Ainda na mesma janela, abra a aba **SSL** e preencha:

| Campo | O que colocar |
|---|---|
| SSL Certificate | `Request a new SSL Certificate` |
| Force SSL | ligado |
| HTTP/2 Support | ligado |
| **HSTS Enabled** | **ligado** |
| Email Address | seu e-mail |
| I Agree to the Let's Encrypt Terms | marcado |

Agora sim, clique em **Save**.

**O que você deve ver:** a janela fecha e o site aparece na lista com o status `Online`. Se der
erro no certificado, quase sempre é o DNS do passo 5 que ainda não se espalhou — espere 15
minutos e tente de novo pelo botão de editar.

> **Por que ligar o HSTS:** é o que faz o navegador recusar abrir o site sem cadeado. Neste
> projeto, essa proteção vinha do Caddy, que você desligou no passo 9 — então ela precisa ser
> ligada aqui, senão fica faltando.

---

# CONFERIR

## Passo 14 — Testar

**No navegador:** abra `https://app.suaempresa.com.br`. Deve aparecer a tela de login do DashSGS,
com o cadeado fechado na barra de endereço.

**No servidor**, confira se tudo está de pé:

```bash
docker compose -f docker/compose.staging.yml --env-file .env.staging ps
```

**O que você deve ver:** os containers `postgres`, `redis`, `api`, `web` e `workers` com status
`Up`. Nos de `postgres` e `api`, deve aparecer também a palavra **`(healthy)`**.

> Esse `(healthy)` no `api` é a melhor confirmação que existe aqui: quem o coloca é o próprio
> container, que de 30 em 30 segundos chama a rota de saúde da aplicação por dentro. Se está
> escrito `(healthy)`, a API está respondendo de verdade — não é só "o processo está ligado".

Se chegou até aqui com o site abrindo, cadeado fechado e `(healthy)` no `api`: **está no ar**. 🎉

---

# Se der errado

Procure a mensagem que apareceu na primeira coluna:

| A mensagem diz… | O que aconteceu | O que fazer |
|---|---|---|
| `Usage: docker compose [OPTIONS] COMMAND` seguido de uma lista enorme | Você esqueceu de colar a última parte do comando (o que fazer: `up`, `build`, `ps`…) | Cole o comando inteiro, até o fim |
| `couldn't find env file` | Você está na pasta errada, ou não fez o passo 6 | `cd /opt/dashsgs` e confira: `ls -la .env.staging` |
| `invalid compose project` | Seu código está desatualizado | `git pull` e tente de novo |
| `pull access denied` / `denied` ao baixar imagem | Falta a autorização do GitHub | Refaça o passo 8 |
| `role "app_rw" already exists` | Você já criou os usuários do banco antes | Nada — pode seguir em frente |
| `(unhealthy)` no banco | O banco não conseguiu subir | Veja o motivo: `docker compose -f docker/compose.staging.yml --env-file .env.staging logs postgres` |
| `port is already allocated` | Outro programa já usa a porta 80 ou 443 | Você esqueceu do `DEPLOY_EDGE=none` no passo 9 |
| O site não abre, mas os containers estão `Up` | O proxy não alcança a aplicação | Refaça o passo 11.3 e confira o nome no passo 12 |

**Para ver o que a aplicação está reclamando**, a qualquer momento:

```bash
docker compose -f docker/compose.staging.yml --env-file .env.staging logs --tail 50 api
```

---

# Depois que subiu

## Comandos do dia a dia

Sempre a partir de `/opt/dashsgs`:

```bash
# ver se está tudo de pé
docker compose -f docker/compose.staging.yml --env-file .env.staging ps

# ver as últimas mensagens da aplicação
docker compose -f docker/compose.staging.yml --env-file .env.staging logs --tail 50 api

# reiniciar a aplicação
docker compose -f docker/compose.staging.yml --env-file .env.staging restart api web
```

## O que ainda falta (e por que importa)

| Pendência | Consequência de deixar assim |
|---|---|
| E-mail (`SMTP_*`) | Convite de usuário e "esqueci minha senha" não funcionam |
| Backup (`WALG_*`) | Se o servidor morrer, os dados vão junto. Ver doc 20 |
| Checagens de produção | Este guia sobe o sistema; ele **não** o torna pronto para clientes reais. A lista do que falta para isso está no doc 32, e hoje tem 19 itens obrigatórios em aberto |

## Para quem quiser entender mais a fundo

- **doc 19** — o manual completo de implantação, com a arquitetura e as decisões
- **doc 35** — a versão técnica deste guia, com as explicações de cada escolha
- **doc 32** — a lista do que falta para uso com clientes reais
