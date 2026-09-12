# 32 — Checklist de Produção (gate de GA)

Nenhum item [BLOQ] pode estar aberto no go-live.

## Autenticação e autorização
- [ ] [BLOQ] Argon2id calibrado por benchmark no hardware de produção
- [ ] [BLOQ] MFA obrigatório p/ owner/admin/platform-admin
- [ ] [BLOQ] Lockout + rate limit de login verificados em produção
- [ ] [BLOQ] Matriz RBAC (doc 07) — suite verde
- [ ] Sessões: expiração absoluta/inatividade conferidas; tela de sessões ativas
- [ ] Convites e recuperação de senha com tokens single-use testados em prod (smoke)

## Isolamento multi-tenant
- [ ] [BLOQ] RLS FORCE em todas as tabelas com tenant_id (introspecção no CI + em prod)
- [ ] [BLOQ] Suite A→B 100% endpoints
- [ ] [BLOQ] Papel da app sem BYPASSRLS/superuser (verificado no banco de produção)
- [ ] Cache: auditoria de chaves com prefixo

## Segurança de aplicação e infra
- [ ] [BLOQ] TLS A+ (ssllabs), HSTS ativo, headers doc 09 presentes
- [ ] [BLOQ] CSP sem unsafe-inline em produção
- [ ] [BLOQ] Pentest externo sem High/Critical abertos
- [ ] [BLOQ] Secrets fora de git/imagens (gitleaks histórico completo verde)
- [ ] [BLOQ] Anti-SSRF de base_url ativo; egress allowlist aplicada no firewall
- [ ] [BLOQ] HTTP público p/ ERP recusado (flag prod)
- [ ] Firewall default-deny; SSH por chave; fail2ban; atualizações automáticas
- [ ] Imagens non-root; Trivy sem CRITICAL; SBOM publicado
- [ ] Dependências: zero CRITICAL conhecidas sem waiver com prazo

## Dados, privacidade e LGPD
- [ ] [BLOQ] Credenciais ERP cifradas (verificar amostra no banco = ciphertext)
- [ ] [BLOQ] Redaction de logs testada em produção (busca por padrões de CPF/senha/token nos sinks = zero)
- [ ] [BLOQ] Módulo Clientes desligado por default; campos vetados ausentes do schema
- [ ] [BLOQ] DPA assinado com tenants ativos; política de privacidade publicada; DPO designado
- [ ] Jobs de retenção/purga agendados e testados (verify-purge)
- [ ] Export com máscara por papel; desmascaramento auditado
- [ ] ROPA atualizado; RIPD template disponível

## Auditoria e observabilidade
- [ ] [BLOQ] app_audit_log append-only (tentativa de UPDATE falha) + hash chain verificada
- [ ] [BLOQ] Alertas operacionais doc 18 §5 ativos e roteados (teste de disparo)
- [ ] Painéis Grafana provisionados; SLO board com dados reais
- [ ] Correlation id fim-a-fim verificado (request→log→Sentry)

## Continuidade
- [ ] [BLOQ] Backup WAL-G ativo p/ storage externo imutável; restore automático semanal VERDE
- [ ] [BLOQ] PITR testado neste mês; game-day DR executado com RTO ≤4 h
- [ ] Runbooks 22 revisados após game-day
- [ ] Status page pronta; contatos de incidente atualizados

## Integração SG
- [ ] [BLOQ] Rate limit cliente ativo por tenant; janelas de backfill configuradas
- [ ] [BLOQ] Sem retry automático em escrita; verificação pré/pós p/ ações (se módulo ativo)
- [ ] Contrato nightly verde 7 dias seguidos; quarentena ~zero
- [ ] Alerta de credencial inválida chegando ao admin do tenant (teste com credencial errada)

## Produto
- [ ] Estados vazio/erro/parcial em todas as telas do MVP
- [ ] Snapshot de KPIs batendo com dataset canônico
- [ ] Smoke E2E pós-deploy automatizado
- [ ] Rollback ensaiado no release anterior ao GA
- [ ] Docs 25/26 acessíveis no app (ajuda)
