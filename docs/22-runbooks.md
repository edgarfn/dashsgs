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
2. Entregue antes o que o contrato exigir: depois da purga não há de onde tirar. (Export
   assistido por enquanto; a rota self-service entra com E9-05.)
3. Em `/plataforma`, "Desligar contrato" na linha do tenant: motivo + slug digitado. É exclusão
   **lógica** — sessões caem, login fecha, dados ficam.
4. D+30 a rodada das 3h20 faz a purga física: espelho, agregados, vínculos, cache (flush por
   prefixo) e contas que ficaram sem nenhum vínculo. O registro do tenant permanece como lápide
   com `purged_at`, e a `app_audit_log` **não** é apagada: ela é o comprovante.
5. Comprovante de destruição (LGPD art. 16): evento `tenant.purged` na trilha, com a contagem de
   linhas por tabela.
6. Fila de espera e verificação: `/plataforma/retencao`, seção "Offboarding aguardando purga
   física". Purga antecipada: botão "Executar purga agora" na mesma tela.

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
Quando usar: o ERP do tenant só expõe HTTP. A plataforma **não** aceita HTTP na internet
(doc 09 §1) — o túnel é o que torna o endereço privado legítimo.

1. Gerar par WireGuard: `dashsgs-cli vpn new --tenant <slug>` (IP dedicado na rede 10.66.x.x).
   *(E6-05; enquanto a CLI não existe, o par é gerado à mão no host da VPN.)*
2. Enviar conf ao TI do tenant (canal seguro); ERP acessível só pelo túnel.
3. Cadastrar `base_url` com IP do túnel e marcar **VPN** no wizard (`tls_mode=vpn`).
4. Verificar handshake e health-check; monitor de túnel ativo.

O que o guarda anti-SSRF faz nesse modo (implementado em `integration/sg/http/url-guard.ts`):

- aceita IP privado **apenas** dentro de `SG_VPN_CIDR` (padrão `10.66.0.0/16`). Fora dela, a
  recusa cita a faixa esperada — inclusive para 10.x, 192.168.x e loopback;
- a checagem se repete **a cada chamada**, não só no cadastro: o endereço é reavaliado antes de
  cada requisição ao ERP, então mudança de DNS (rebinding) não atravessa;
- trocar a rede do túnel é mudar `SG_VPN_CIDR` no ambiente da API e reiniciar — nunca editar o
  código do guarda.

Se o túnel cair, a conexão vai a `error` com motivo "inalcançável" e o admin do tenant recebe
alerta (E8-05); a credencial permanece válida no cofre, nada precisa ser recadastrado.

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
1. Em `/plataforma/break-glass`, abra o pedido: tenant, chamado, justificativa (o cliente lê
   este texto), papel mínimo que resolve e duração (padrão 2 h, teto 8 h).
2. **Outra pessoa da equipe aprova** na mesma tela — o sistema recusa auto-aprovação. Na
   aprovação, o owner do tenant recebe o e-mail de aviso e o prazo começa a contar.
3. Trabalhe: todas as telas passam a mostrar uma faixa vermelha, e cada requisição entra no
   relatório.
4. **Revogue assim que terminar** — não espere o prazo. O relatório (`Relatório (n acessos)`)
   lista rota, hora e origem; é ele que vai anexado ao chamado.

O comando de CLI previsto na versão anterior deste runbook virou tela porque a aprovação de
segunda pessoa exige alguém autenticado, com MFA recente — o que um binário na máquina do
operador não garante.

## 12. Provar que a retenção está sendo cumprida
1. Abra `/plataforma/retencao`. A coluna "Fora do prazo" tem de ser uma coluna de zeros.
2. Se houver número diferente de zero, clique em "Executar purga agora" e confira de novo. Se
   não zerar, a política não está sendo cumprida — é incidente, não é enfeite.
3. Em Prometheus, o mesmo dado é `retention_pending_rows`. O alerta operacional dispara com
   qualquer valor acima de zero por mais de 24 h.
