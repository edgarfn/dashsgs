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
3. Restaurar o banco:
   ```bash
   # Na VM nova, com as variáveis WALG_* do cofre exportadas:
   docker run --rm -e WALG_S3_PREFIX -e WALG_LIBSODIUM_KEY      -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ENDPOINT      -v pgdata:/var/lib/postgresql/data dashsgs/postgres:17-walg      wal-g backup-fetch /var/lib/postgresql/data LATEST
   ```
   Para um ponto no tempo, em vez de `LATEST`: escreva `recovery_target_time` em
   `postgresql.auto.conf` junto de `restore_command = 'wal-g wal-fetch "%f" "%p"'`.
4. Subir stack com digest atual; smoke; apontar DNS (TTL 300 s).
5. `dashsgs-cli sync recover-gap --all-tenants` (reprocessa janelas desde o ponto restaurado).
6. Relatório pós-incidente em 72 h.

**Antes de precisar**: `pnpm dr:restore-test` responde "o backup de hoje restaura?" em minutos,
sem tocar em produção. É o mesmo script que roda sozinho aos domingos.

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

## 13. Subir, conferir e mexer na observabilidade

```bash
pnpm obs:up          # staging + stack de observabilidade, um projeto só
pnpm obs:check       # gate: nenhuma regra/painel cita métrica que ninguém emite
```

O Grafana **não** tem porta pública: `ssh -L 3000:127.0.0.1:3000 <host>` e abra
`http://localhost:3000`. Painéis são código (`docker/observability/grafana/paineis/`); editar
pela interface não persiste — `allowUiUpdates: false` de propósito, porque painel editado no
navegador some no próximo deploy, e some justamente quando alguém precisa dele.

**Depois de mexer em regra ou painel:**

1. `pnpm obs:check` — reprova métrica inexistente, valor de rótulo fora do vocabulário e alerta
   sem `runbook`.
2. `docker compose ... exec prometheus promtool check rules /etc/prometheus/regras/*.yml`.
3. Recarregar sem reiniciar: `curl -X POST http://prometheus:9090/-/reload`.

**Conferir que um alerta realmente dispara** (é o que o doc 32 cobra no go-live):

```bash
# 1. Ver a regra avaliada e seu estado atual
curl -s http://prometheus:9090/api/v1/rules | jq '.data.groups[].rules[] | {name, state}'
# 2. Forçar um alerta de teste direto no Alertmanager (chega o e-mail de verdade)
curl -s -XPOST http://alertmanager:9093/api/v2/alerts -H 'content-type: application/json' -d '[{
  "labels": {"alertname": "TesteDeRota", "severity": "page"},
  "annotations": {"resumo": "teste de rota do on-call", "runbook": "doc 22 §13"}
}]'
```

Alerta barulhento é problema, não paisagem: ou o limiar sobe, ou a causa é corrigida, ou a regra
sai. Deixar disparando "porque a gente já sabe" treina a equipe a ignorar o pager.

## 14. Backup: conferir, restaurar e trocar a chave

**Está rodando?**

```bash
# Idade do último backup, direto da série que alimenta o alerta:
curl -s 'http://prometheus:9090/api/v1/query?query=time()-backup_last_success_timestamp_seconds' | jq
docker compose -f docker/compose.staging.yml logs backup --tail 50
```

**Restaurar para conferir** (não toca em produção; sobe um cluster efêmero na porta 55433):

```bash
pnpm dr:restore-test           # último backup
pnpm dr:restore-test base_000000010000000000000003   # um específico
```

Saída esperada: migrações aplicadas, contagens por tabela e `cadeia de auditoria íntegra`.
Qualquer falha publica `restore_test_last_result 0` e o alerta sai por conta própria.

**PITR para um instante específico** (teste mensal do doc 20 §3): mesmo procedimento do §9,
trocando `recovery_target = 'immediate'` por `recovery_target_time = '2026-09-16 14:00:00-03'`.

**Trocar a chave de cifra**: WAL-G cifra por backup, não por bucket. Troque
`WALG_LIBSODIUM_KEY`, reinicie `postgres` e `backup`, e **guarde a chave antiga** enquanto
existir backup cifrado com ela — 35 dias de PITR. Chave antiga descartada cedo demais transforma
o backup de ontem em ruído aleatório.

**Trocar a imagem do Postgres**: a base é `bookworm` (glibc) porque o WAL-G oficial não roda em
musl. Se algum dia a base voltar a mudar, `REINDEX DATABASE` é obrigatório — glibc e musl
ordenam texto diferente, e índice de texto lido sob outra collation devolve resultado errado sem
acusar erro em lugar nenhum.
