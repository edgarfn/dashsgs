# 22 — Runbooks (Procedimentos Operacionais)

Cada runbook: pré-condições → passos → verificação → rollback. Comandos assumem acesso via
bastion e `dashsgs-cli` (utilitário administrativo interno a construir junto do backend —
subcomandos citados abaixo fazem parte do backlog).

## 1. Provisionar tenant
1. Painel platform-admin → Novo tenant (nome, slug, plano) → convite ao owner.
2. Owner: wizard de conexão ERP (doc 19 §7). Exigir HTTPS ou VPN (ver §7).
3. Verificar: status conexão OK, `routes_granted` cobre módulos do plano.
4. `dashsgs-cli sync backfill --tenant <slug> --window 2100..0600 --depth 26m`
5. Verificação: painel de backfill 100%; KPIs de 90 dias visíveis; alertas padrão criados.

## 2. Suspender / reativar tenant
`dashsgs-cli tenant suspend|resume <slug>` → verifica: logins bloqueados, jobs pausados
(suspend) / watermarks retomam e recuperam gap (resume). Auditar motivo.

## 3. Offboarding com purge (LGPD)
1. Owner solicita por escrito → ticket.
2. `dashsgs-cli tenant export <slug>` → entregar dump cifrado ao owner (link expira 7 dias).
3. `dashsgs-cli tenant offboard <slug>` → soft delete + agenda purge D+30.
4. D+30 job de purge físico: espelhos, agregados, usuários exclusivos, cache (flush prefixo),
   exports. Auditoria de destruição gravada (fora do escopo do purge, com hash do relatório).
5. Verificação: `dashsgs-cli tenant verify-purge <slug>` (contagens zero em todas as tabelas).

## 4. Re-sincronizar / reconciliar período
`dashsgs-cli sync run --tenant <slug> --domain vendas --filial 3 --from 2026-08-01 --to 2026-08-31`
- Idempotente (upsert). Para suspeita de duplicidade no dia: usar `--consolidate` (delete+insert
  transacional do dia). Verificar contagens vs `quantidadeItens` da API no log do run.

## 5. Rotacionar segredos
| Segredo | Passos |
|---|---|
| Chave mestra (envelope) | gerar nova → `MASTER_KEY_CURRENT`=nova, `PREVIOUS`=antiga → deploy → `dashsgs-cli crypto rewrap` (recifra colunas com nova versão) → após 100%, remover PREVIOUS no próximo deploy |
| Senha ERP de um tenant | solicitar à SG → Admin→Conexão (owner, MFA) → teste automático → confirmar sync verde |
| SESSION_SECRET | dupla chave (aceita antiga p/ validação por 24 h) → deploy → remover antiga |
| Credenciais DB | criar usuário novo → trocar env → deploy rolling → dropar antigo |

## 6. Drenar DLQ
1. Painel Filas → inspecionar payloads da DLQ (sem PII por design).
2. Causa corrigida? `dashsgs-cli queue replay --queue <q> --limit N`.
3. Jobs venenosos: `queue discard --id ...` com justificativa (auditado).

## 7. Provisionar VPN para tenant sem HTTPS
1. Gerar par WireGuard: `dashsgs-cli vpn new --tenant <slug>` (IP dedicado na rede 10.66.x.x).
2. Enviar conf ao TI do tenant (canal seguro); ERP acessível só pelo túnel.
3. Cadastrar `base_url` com IP do túnel; `tls_mode=vpn`.
4. Verificar handshake e health-check; monitor de túnel ativo.

## 8. Incidente de segurança → seguir doc 27 (não improvisar aqui).

## 9. Disaster recovery (resumo executável; detalhes doc 20)
1. Declarar DR (CTO). Comunicar status page.
2. Nova VM por cloud-init (`infra/cloudinit.yaml`) → instalar compose.
3. `walg backup-fetch` último base + replay WAL até ponto alvo.
4. Subir stack com digest atual; smoke; apontar DNS (TTL 300 s).
5. `dashsgs-cli sync recover-gap --all-tenants` (reprocessa janelas desde o ponto restaurado).
6. Relatório pós-incidente em 72 h.

## 10. Atualização de dependências críticas
Renovate abre PR → CI completo → staging 24 h → produção. Para patch de segurança CRITICAL:
fast-track com aprovação dupla e monitoração pós-deploy 1 h.

## 11. Break-glass (acesso excepcional a dados de tenant)
1. Ticket com justificativa + aprovação de 2ª pessoa.
2. `dashsgs-cli breakglass grant --user <admin> --tenant <slug> --ttl 2h` (gera sessão especial
   auditada; owner do tenant é notificado automaticamente).
3. Expira sozinho; relatório do que foi acessado anexado ao ticket.
