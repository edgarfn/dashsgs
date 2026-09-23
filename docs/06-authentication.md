# 06 — Autenticação

Dois domínios distintos de autenticação, que **nunca se misturam**:

1. **Usuário → DashSGS** (nosso app)
2. **DashSGS → API SG** (credencial de integração por tenant)

## 1. Autenticação do usuário no DashSGS

### Estratégia: sessão server-side (ADR-004)
- Login: e-mail + senha → sessão opaca (token aleatório 256 bits, armazenado como hash SHA-256 em
  `app_sessions`) → cookie `__Host-session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- Por que não JWT no browser: revogação imediata (logout, bloqueio, troca de senha), sem
  superfície de XSS-token-theft, sem gestão de refresh no cliente. Custo (1 lookup/req) é
  irrelevante no nosso volume e mitigável com cache Redis de sessão.

### Senhas
- **Argon2id** (memory 64 MiB, iterations 3, parallelism 4 — recalibrar por benchmark).
- Política: mínimo 12 caracteres, checagem contra lista de senhas vazadas (ex.: zxcvbn score ≥3);
  sem regras arbitrárias de composição; sem expiração periódica forçada (NIST 800-63B).
- Nunca em texto puro, nunca em logs, nunca em URL.

### MFA
- TOTP (RFC 6238) opcional por usuário e **obrigatório** para papéis `owner/admin` e para o
  super-admin da plataforma. Códigos de recuperação one-time (10, hash no banco).
- Rate limit de verificação TOTP: 5 tentativas/5 min.

### Fluxos
| Fluxo | Regras |
|---|---|
| Login | Cloudflare Turnstile (widget na tela) verificado antes de tocar o banco; rate limit por IP (10/min) e por conta (5 falhas → lock incremental 1→15 min); mensagem genérica "credenciais inválidas" para captcha inválido, conta inexistente OU senha errada; auditar sucesso e falha |
| Logout | Revoga sessão no servidor; limpa cookie |
| Recuperação de senha | Token single-use 30 min (hash no banco), e-mail com link; resposta idêntica exista ou não a conta; invalida sessões ao redefinir |
| Troca de senha | Exige senha atual; invalida todas as outras sessões |
| Sessões ativas | Tela "meus dispositivos": lista sessões (IP, UA, data) e permite revogar individualmente |
| Expiração | Sessão absoluta 12 h; inatividade 60 min (renovação deslizante); MFA re-desafio para ações sensíveis (gestão de credencial ERP, aprovação de escrita no ERP) |

### Contas e convites
- Onboarding por convite (e-mail com token) vinculado a tenant+papel; sem auto-registro público.
- Super-admin da plataforma: contas separadas, MFA obrigatório, allowlist de IP opcional.

## 4. Estado da implementação (Fase 3)

O que já está no código, e onde:

| Spec | Implementação |
|---|---|
| Sessão opaca + cookie | `apps/api/src/modules/auth/services/session.service.ts` |
| Argon2id e hashes | `apps/api/src/common/crypto/hashing.service.ts` |
| Política de senha (zxcvbn) | `apps/api/src/modules/auth/services/password-policy.service.ts` |
| Login, lockout e MFA | `apps/api/src/modules/auth/services/auth.service.ts` |
| TOTP e códigos de recuperação | `apps/api/src/modules/auth/services/totp.service.ts` |
| Recuperação/troca de senha | `apps/api/src/modules/auth/services/password.service.ts` |
| Convites | `apps/api/src/modules/auth/services/invite.service.ts` |
| Guards (sessão, CSRF, permissões) | `apps/api/src/modules/auth/guards/` |
| Telas | `apps/web/src/app/(auth)/` e `apps/web/src/app/perfil/` |

Ajustes de rota em relação ao doc 23, feitos durante a implementação:

- `POST /auth/mfa/setup` e `POST /auth/mfa/enable` são etapas distintas: o segredo fica pendente
  no Redis (cifrado, TTL 15 min) e só vai para o banco quando a pessoa prova o código. Cadastro
  abandonado não deixa MFA meio-ligado.
- `GET /me/pending` devolve o perfil de uma sessão que ainda não concluiu o MFA — é o que as
  telas de desafio e cadastro precisam para se desenhar.
- `POST /auth/tenant` fixa o tenant ativo da sessão (usuário com mais de um vínculo).

Em desenvolvimento os cookies são `dashsgs_session`/`dashsgs_csrf`; em produção ganham o prefixo
`__Host-`, que exige `Secure` — e `Secure` sobre `http://localhost` não funciona em todo navegador.

## 2. Credencial de integração (DashSGS → API SG)

### Provisionamento
- Fornecida pelo comercial da SG por tenant [DOCUMENTADO]. Solicitar **usuário com o menor conjunto
  de rotas necessário** (somente leitura para o MVP) — least privilege no contrato.
- Cadastro pela UI (papel `owner/admin` do tenant, com MFA): `base_url`, flag SG Cloud, usuário,
  senha. A senha é cifrada (AES-256-GCM envelope) no ato; **nunca** é reexibida — apenas
  substituível.
- Validação no cadastro: resolução DNS + bloqueio de IP privado (anti-SSRF), teste de
  `POST /autorizacao` e `GET /status`, captura da claim `routes` → `routes_granted`.

### Token manager (por tenant)
```
getToken(tenant):
  cache Redis "sgtoken:<tenant>" (TTL = exp - 10 min)
  se ausente/expirando: lock distribuído → POST /autorizacao → valida resposta →
  armazena token + routes; em 401 no uso: invalida cache, 1 retry; falha → circuit breaker
  e alerta de credencial inválida (status da conexão vai a 'error')
```
- Token **nunca** sai do backend; nunca vai a logs (redaction automática no logger).
- Renovação antecipada a ~50 min evita corrida no minuto 60 [DOCUMENTADO: validade 1 h].
- Formato do header: enviar o JWT puro em `Authorization` (conforme exemplos);
  fallback com prefixo `Bearer ` se 401 — [NECESSITA CONFIRMAÇÃO do formato canônico].

### Transporte
- `tls_mode` por conexão: `https` (padrão exigido) ou `vpn` (túnel gerenciado, ex.: WireGuard,
  quando o ERP só expõe HTTP interno). `http` público é **recusado pelo produto**
  [RECOMENDAÇÃO de segurança; a doc da SG só mostra HTTP — NECESSITA CONFIRMAÇÃO de suporte a TLS].

## 3. Ameaças e controles (resumo)

| Ameaça | Controle |
|---|---|
| Credential stuffing no login | Cloudflare Turnstile, rate limit IP+conta, lock incremental, MFA, monitorar picos de 401 |
| Automação/bot na tela de login | Turnstile fail-closed: Cloudflare fora do ar = login recusado, não bypass silencioso. Chave de teste (sempre aprova) só fora de produção — banida no boot em `NODE_ENV=production` (doc 19 §3) |
| Session hijacking | Cookie HttpOnly+Secure, rotação de id de sessão no login, binding suave a UA |
| CSRF | SameSite=Lax + token anti-CSRF em mutações (double-submit) |
| Vazamento da senha ERP | Cifra em repouso, chave fora do banco, redaction em logs, sem reexibição, auditoria de leitura |
| Replay do token SG | TTL curto do próprio token; TLS; token confinado ao backend |
| Enumeração de usuários | Respostas homogêneas em login/recuperação |

## 6. Perda do segundo fator (lacuna conhecida)

O §MFA prevê **códigos de recuperação** como saída de quem perde o autenticador — e é o que a
tela "Perdi o acesso ao aplicativo" usa. Não há previsão para quem perde os dois: hoje a conta
fica sem caminho de volta pela interface, porque nem o admin do tenant nem a operação da
plataforma têm ação para desligar o MFA de um membro (a tela de usuários apenas **mostra** "MFA
ativo").

Em desenvolvimento isso aparece com facilidade: a suíte E2E cadastra um TOTP cujo segredo morre
com o teste. `pnpm db:seed` devolve as contas sintéticas ao primeiro acesso (senha conhecida, MFA
desligado, sessões encerradas) e o `globalTeardown` do Playwright faz o mesmo ao fim da suíte.
Nenhum dos dois serve para produção: lá a correção é **E2-08** — reset do MFA de um membro pelo
admin do tenant, auditado e com aviso ao dono da conta.
