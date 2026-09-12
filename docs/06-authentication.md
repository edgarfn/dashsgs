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
| Login | Rate limit por IP (10/min) e por conta (5 falhas → lock incremental 1→15 min); mensagem genérica "credenciais inválidas"; auditar sucesso e falha |
| Logout | Revoga sessão no servidor; limpa cookie |
| Recuperação de senha | Token single-use 30 min (hash no banco), e-mail com link; resposta idêntica exista ou não a conta; invalida sessões ao redefinir |
| Troca de senha | Exige senha atual; invalida todas as outras sessões |
| Sessões ativas | Tela "meus dispositivos": lista sessões (IP, UA, data) e permite revogar individualmente |
| Expiração | Sessão absoluta 12 h; inatividade 60 min (renovação deslizante); MFA re-desafio para ações sensíveis (gestão de credencial ERP, aprovação de escrita no ERP) |

### Contas e convites
- Onboarding por convite (e-mail com token) vinculado a tenant+papel; sem auto-registro público.
- Super-admin da plataforma: contas separadas, MFA obrigatório, allowlist de IP opcional.

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
| Credential stuffing no login | Rate limit IP+conta, lock incremental, MFA, monitorar picos de 401 |
| Session hijacking | Cookie HttpOnly+Secure, rotação de id de sessão no login, binding suave a UA |
| CSRF | SameSite=Lax + token anti-CSRF em mutações (double-submit) |
| Vazamento da senha ERP | Cifra em repouso, chave fora do banco, redaction em logs, sem reexibição, auditoria de leitura |
| Replay do token SG | TTL curto do próprio token; TLS; token confinado ao backend |
| Enumeração de usuários | Respostas homogêneas em login/recuperação |
