# 27 — Plano de Resposta a Incidentes de Segurança

## 1. Definições e severidades

| Sev | Exemplos | Resposta |
|---|---|---|
| SEV1 | Vazamento de dados de tenant/titulares; comprometimento de credencial ERP; ransomware; acesso não autorizado confirmado | Imediata, 24×7, war-room |
| SEV2 | Vulnerabilidade crítica explorável exposta; tentativa de intrusão com indícios de sucesso parcial; perda de trilha de auditoria | ≤ 4 h |
| SEV3 | Scan/bruteforce bloqueado, vulnerabilidade crítica sem exposição, phishing contra equipe | ≤ 24 h |

Incident Commander (IC): primeiro respondente sênior; comunica-se por canal dedicado
(fora da infraestrutura afetada — ex.: Signal/telefone se e-mail comprometido).

## 2. Fases (NIST 800-61)

### Detecção e análise
Fontes: alertas doc 18 §5, Sentry, denúncia de usuário, aviso de terceiro. Primeiros 30 min:
preservar evidências (snapshot de VM/volumes, export de logs do período), linha do tempo inicial,
classificar severidade, abrir registro do incidente (modelo §5).

### Contenção
| Cenário | Contenção imediata |
|---|---|
| Conta de usuário comprometida | Revogar sessões + reset + bloquear; revisar ações na auditoria |
| Credencial ERP de tenant exposta | **Acionar SG/tenant para trocar a senha do usuário de integração** (não temos revogação — token vive 1 h [DOCUMENTADO]); pausar sync; trocar no cofre |
| Chave mestra/segredos expostos | Rotação total (runbook 22 §5), invalidar sessões, redeploy |
| Vazamento cross-tenant (bug) | Desativar endpoint/feature (flag), avaliar extensão via logs, comunicar afetados |
| Servidor comprometido | Isolar da rede (manter ligado p/ forense), failover p/ infra limpa via DR |
| Dependência maliciosa (supply chain) | Congelar deploys, identificar versão, rebuild de imagem limpa, rotação de segredos |

### Erradicação e recuperação
Corrigir causa raiz → restaurar de artefatos/backup confiáveis (imutáveis) → monitoração
reforçada 72 h → encerrar somente com evidência de ambiente limpo.

### Pós-incidente
Post-mortem sem culpados em ≤5 dias úteis: linha do tempo, causa raiz, o que funcionou/falhou,
ações com dono e prazo. Atualizar runbooks/controles.

## 3. Obrigações de comunicação (LGPD)

- **Ao Controlador (tenant)**: incidente envolvendo dados sob nosso tratamento → comunicar o
  admin/owner **em até 24 h** do reconhecimento, com natureza, dados afetados, medidas.
  (Obrigação contratual do DPA — doc 28.)
- **ANPD e titulares**: decisão do Controlador; fornecemos todo o suporte técnico e o relatório.
  Prazo regulamentar de comunicação à ANPD: 3 dias úteis (Res. CD/ANPD 15/2024) — nosso material
  deve chegar ao Controlador a tempo.
- Registro interno de TODOS os incidentes (mesmo sem obrigação de notificar) por 5 anos.

## 4. Preparação contínua

- Contatos atualizados: on-call, CTO, jurídico, DPO dos maiores tenants, contato técnico SG.
- Acessos de emergência testados (break-glass, chaves de backup).
- Tabletop semestral alternando cenários (§2) — registrar lições.
- Forense básica: relógio NTP em tudo, logs com retenção de segurança 90 d, snapshots rápidos.

## 5. Modelo de registro de incidente

```
ID: IR-AAAA-NNN     Sev: __   IC: __
Detecção (quando/como):
Linha do tempo (UTC-3):
Sistemas/tenants/dados afetados:
Contenção aplicada:
Causa raiz:
Erradicação/recuperação:
Comunicações feitas (quem/quando):
Evidências preservadas (onde):
Ações pós-incidente (dono/prazo):
```
