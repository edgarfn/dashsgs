# 09 — Plano de Segurança (Security by Design)

Referências: OWASP ASVS 4.0 (alvo: nível 2), OWASP Top 10 2021, OWASP API Security Top 10 2023,
CIS Benchmarks (Docker/PostgreSQL/OS).

## 1. Controles por camada

### Frontend
- CSP estrita: `default-src 'self'`; sem `unsafe-inline` (nonces para o Next.js); `frame-ancestors 'none'`.
- Cookies: `__Host-` prefix, HttpOnly, Secure, SameSite=Lax; anti-CSRF em mutações.
- Sem segredos, sem token SG, sem lógica de autorização confiável no cliente.
- Output encoding por padrão (React); sanitizar qualquer HTML vindo de dados do ERP
  (descrições de produto/observações podem conter payloads — API10 unsafe consumption).
- Dependências auditadas (SCA no CI); Subresource Integrity para terceiros (evitar terceiros).

### Backend (API interna)
- Validação de entrada em TODAS as rotas (zod/class-validator, whitelist + tipos + limites de
  tamanho); rejeitar campos extras (`forbidNonWhitelisted`).
- Autorização central (guards) + RLS (doc 08). IDs internos são UUID (não sequenciais).
- Rate limiting por sessão/IP (Redis token bucket): login 10/min/IP, API 100/min/sessão,
  export 5/min/tenant. Respostas 429 com Retry-After.
- Security headers (via Caddy + Helmet): HSTS (max-age 63072000; preload após estabilização),
  X-Content-Type-Options, Referrer-Policy strict-origin-when-cross-origin,
  Permissions-Policy mínima, COOP/COEP quando viável.
- CORS: allowlist estrita do domínio do frontend; credenciais somente same-site.
- Erros: handler global → `{codigo_interno, mensagem_segura, correlation_id, timestamp}`;
  stack trace apenas em log estruturado (doc 18/21).
- Upload: inexistente no MVP (superfície zero).
- Anti-SSRF no cadastro de `base_url` (doc 06 §2) + egress permitido apenas aos hosts ERP
  registrados e serviços de e-mail (firewall de saída/proxy).

### Integração SG
- TLS obrigatório ou VPN (recusa HTTP público).
- Redaction automática: `senha`, `token`, `Authorization` jamais em logs (processor no logger).
- Circuit breaker por tenant; self-rate-limit configurável (padrão 4 req/s por tenant
  [RECOMENDAÇÃO — sem limite documentado pela SG]).
- Validação de resposta com schema (zod) antes de persistir — dados fora do contrato vão para
  quarentena (`sync_job_runs.error`) em vez de corromper o espelho.
- Credencial somente-leitura solicitada por padrão; rotas de escrita só quando o módulo de ações
  for contratado (least privilege no contrato com a SG).

### Banco
- RLS + FORCE em todas as tabelas de tenant; papéis mínimos (app_rw, app_migrator, app_readonly
  p/ BI interno); sem superuser na aplicação.
- TLS nas conexões; `scram-sha-256`; rede privada apenas.
- Colunas cifradas (senha ERP, TOTP secrets) com versão de chave; rotação documentada (doc 22).
- Auditoria append-only com hash chain (doc 05 §6).
- Backups cifrados testados (doc 20).

### Infraestrutura
- SO: hardening CIS, atualizações automáticas de segurança, SSH somente chave + MFA no bastion,
  fail2ban, firewall default-deny (entrada: 80/443; saída: allowlist).
- Docker: imagens distroless/slim, non-root, read-only rootfs quando possível, sem privileged,
  scan (Trivy) no CI e agendado, secrets via env-file com permissão 600/secret manager (nunca em
  imagem ou repositório).
- Rede: DB/Redis sem exposição pública; segmentação por rede Docker; WAF/CDN opcional na borda.

### CI/CD (detalhado no doc 11)
- Branch protection, revisão obrigatória, commits assinados [RECOMENDAÇÃO].
- Gates: lint, testes, SAST (Semgrep), SCA (osv-scanner/npm audit), secret scan (gitleaks),
  container scan (Trivy), DAST (ZAP baseline) em staging.
- Deploy por artefato imutável (digest da imagem); rollback documentado.

## 2. Gestão de segredos

| Segredo | Onde vive | Rotação |
|---|---|---|
| Chave mestra de cifra (envelope) | ENV do backend, proveniente de SOPS/KMS | Anual ou em incidente; suporte a multiversão (`secret_key_version`) |
| Senha ERP do tenant | `app_erp_connections.secret_ciphertext` | Sob demanda junto à SG; runbook 22 §5 |
| Credenciais DB/Redis/SMTP | SOPS/secret manager | Semestral |
| Cookie/CSRF signing keys | ENV | Rotação com sobreposição (dupla chave) |
| Tokens SG (runtime) | Redis com TTL, cifrado em trânsito | Auto-expira 1 h |

Regra absoluta: **nenhum segredo no Git** (gitleaks bloqueia PR e histórico é verificado).

## 3. Mapeamento OWASP API Top 10 → controles do DashSGS (nossa API interna)

| Risco | Controle principal |
|---|---|
| API1 BOLA | RLS + repositórios sempre filtrados por tenant/filial + UUIDs + testes A→B |
| API2 Auth | Sessões server-side, Argon2id, MFA, rate limit, lockout |
| API3 Property auth | DTOs de resposta explícitos (nunca `SELECT *` → serialização por schema); máscara de CPF/CNPJ por papel |
| API4 Consumption | Rate limits, paginação obrigatória, limites de export, timeouts, quotas de sync por tenant |
| API5 Function auth | Guard central + catálogo de permissões versionado + testes de matriz |
| API6 Business flows | Workflow aprovação p/ escrita ERP, segregação proponente≠aprovador, MFA recente |
| API7 SSRF | Validação de base_url, bloqueio de IP privado/link-local/metadata, egress allowlist |
| API8 Misconfig | IaC revisada, headers, scans agendados, ambientes idênticos por imagem |
| API9 Inventory | Rotas geradas de um único router tipado; OpenAPI interno gerado e diffado no CI |
| API10 3rd-party | Validação por schema de TUDO que vem da API SG; sanitização; quarentena |

## 4. Modelagem de ameaças (STRIDE — resumo das principais)

| Ameaça | Vetor | Mitigação |
|---|---|---|
| Spoofing | Roubo de sessão/cookie | HttpOnly+Secure, rotação, expiração, revogação |
| Tampering | Alteração de auditoria | Append-only + hash chain + backup externo |
| Repudiation | Ator nega ação de escrita no ERP | Auditoria com ator, MFA recente, payload e resposta |
| Info disclosure | Vazamento cross-tenant | RLS + testes; cache prefixado; logs por tenant |
| Info disclosure | Vazamento credencial ERP | Cofre, cifra, redaction, sem reexibição |
| DoS | Sync agressivo derruba ERP do cliente | Self-rate-limit, janelas, circuit breaker, horário configurável |
| Elevation | Manager vira admin via API | Matriz de permissão testada, mudanças de papel auditadas + notificação ao owner |

## 5. Verificação contínua

- Pentest externo antes do GA e anual.
- Revisão de dependências semanal automatizada (Renovate) com gate de severidade.
- Tabletop de incidente semestral (doc 27).
- Checklist ASVS L2 rastreado por release (doc 32 vincula os itens críticos).
