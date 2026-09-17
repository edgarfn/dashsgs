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
- [x] [BLOQ] CSP sem unsafe-inline em produção — política estrita fora de `development`;
      `e2e/seguranca.spec.ts` abre as 12 telas do MVP contra o build de produção e falha com
      qualquer violação (Fase 9). Falta confirmar no domínio real depois do deploy.
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
- [x] Jobs de retenção/purga agendados e testados (verify-purge) — 23 políticas em
      `modules/retencao/politicas.ts`, rodada diária às 3h20, painel em `/plataforma/retencao`,
      gauge `retention_pending_rows`. O teste de integração purga e exige verificação zero.
- [ ] Export com máscara por papel; desmascaramento auditado
- [ ] ROPA atualizado; RIPD template disponível

## Auditoria e observabilidade
- [x] [BLOQ] app_audit_log append-only (tentativa de UPDATE falha) + hash chain verificada —
      privilégio revogado + trigger; a **única** exclusão admitida é a da retenção de 5 anos,
      por `app_purge_audit_log()`, com o prazo fixo dentro do banco (Fase 9). A verificação da
      cadeia virou tela em `/plataforma` e endpoint (`GET /platform/auditoria/verificacao`), com
      teste que insere linha por fora do serviço e exige que ela seja apontada (E6-01)
- [x] Trilha consultável pelo cliente — `/admin/auditoria` com filtros, export CSV auditado e o
      recorte por membro que a RLS de identidade sozinha não dá (E6-01)
- [x] [BLOQ] Alertas operacionais doc 18 §5 **escritos, versionados e conferidos** — 35 regras em
      `docker/observability/prometheus/regras/`, cada uma com `resumo` e `runbook`; o gate
      `pnpm obs:check` roda no CI e reprova alerta que cite métrica ou valor de rótulo que
      ninguém emite (foi assim que dois alertas natimortos apareceram). **Falta** o teste de
      disparo ponta a ponta contra o SMTP real — runbook 22 §13 tem o comando
- [x] Painéis Grafana provisionados (5, provisionados de arquivo, `allowUiUpdates: false`); SLO
      board pronto — **falta** rodar com dados reais, o que só existe com produção
- [ ] Correlation id fim-a-fim verificado (request→log→Sentry)

## Continuidade
- [x] [BLOQ] Backup WAL-G ativo p/ storage externo imutável; restore automático semanal VERDE —
      WAL-G na imagem do banco, `archive_command` contínuo, base + dump diários às 06:10 UTC e
      restauração semanal que confere migrações, contagens e a cadeia de auditoria. **Falta**
      apontar para o bucket real com object-lock ligado, que é configuração de produção
- [ ] [BLOQ] PITR testado neste mês; game-day DR executado com RTO ≤4 h — o mecanismo de PITR
      está no runbook 22 §14; o cronômetro exige VM nova e DNS
- [ ] Runbooks 22 revisados após game-day (§§13 e 14 escritos na Fase 10, ainda não exercitados
      sob incidente real)
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

## Estado em 14/09/2026 (fim da Fase 9)

O que a Fase 9 fechou, e como se confere sem acreditar em ninguém:

| Item | Prova |
|---|---|
| CSP sem `unsafe-inline` | `pnpm test:e2e e2e/seguranca.spec.ts` contra `next start` |
| Retenção executada e verificada | `/plataforma/retencao` com coluna de zeros; `retencao.int-spec.ts` |
| Offboarding físico com comprovante | evento `tenant.purged` na trilha, com linhas por tabela |
| Break-glass com 2ª pessoa e relatório | `/plataforma/break-glass`; `retencao.int-spec.ts` |
| Auditoria append-only com exceção só de vencimento | teste que tenta `DELETE` e exige recusa |

O que **não** pode ser fechado por código e continua aberto para o go-live:

- **Pentest externo (E9-01)**: contratação e correção dos achados. Nada aqui substitui.
- **DPA, política de privacidade e DPO (E9-04)**: jurídico.
- **TLS A+, HSTS, firewall, backups e game-day**: dependem do ambiente de produção, que ainda
  não existe — entram na Fase 10 (observabilidade/SRE) e no go-live.
- **Billing (E9-05) e status page (E9-06)**: Fase 12, conforme o roadmap.
