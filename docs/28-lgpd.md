# 28 — Conformidade LGPD

Complementa o doc 10 (controles técnicos) com o arcabouço jurídico-organizacional.
**Nada aqui é parecer jurídico; bases legais devem ser validadas por advogado/DPO.**

## 1. Papéis

| Papel | Quem | Observação |
|---|---|---|
| Controlador | Tenant (rede varejista) | Decide finalidades sobre dados do seu ERP |
| Operador | DashSGS | Trata conforme instruções documentadas (DPA) |
| Suboperadores | Hosting/cloud, provedor SMTP, (futuro) provedores de notificação | Listados no DPA; mudança com aviso prévio de 30 dias |
| Encarregado (DPO) do DashSGS | A designar antes do GA | Canal: privacidade@dashsgs [definir] |

## 2. Contrato de tratamento (DPA) — cláusulas mínimas
Escopo e instruções; confidencialidade; medidas técnicas (referenciar docs 09/10);
suboperadores; auditoria pelo Controlador (mediante aviso); notificação de incidente ≤24 h;
assistência a direitos de titulares (≤72 h úteis); término = devolução (export) + eliminação
comprovada (relatório de purge); vedação de uso próprio dos dados; transferência internacional
(ver §5).

## 3. ROPA (Registro das Operações — art. 37) — DashSGS como Operador

| Operação | Dados | Titulares | Finalidade (do Controlador) | Base legal candidata* | Retenção |
|---|---|---|---|---|---|
| Conta e autenticação de usuários do app | nome, e-mail, hash de senha, IP, sessões | usuários do tenant | administração do serviço | Execução de contrato (art. 7º V) | conta + 6 m |
| Auditoria de uso | ator, ação, IP, timestamps | usuários | segurança e accountability | Legítimo interesse (7º IX) / obrigação (7º II p/ certos registros) | 5 anos |
| Espelho de vendas com cliente identificado (módulo Clientes) | id, nome, CPF (hash+máscara), tipo, município, limite | consumidores do tenant | análise de vendas/crédito | A DEFINIR PELO CONTROLADOR (provável legítimo interesse com LIA, ou execução de contrato p/ crediário) | módulo ativo |
| Vendedores | nome, CPF mascarado, comissões | funcionários do tenant | análise de desempenho | A DEFINIR PELO CONTROLADOR (contrato de trabalho/legítimo interesse) | vínculo + 12 m |
| Usuários citados em registros do ERP | login/nome em campos operacionais | funcionários do tenant | investigação operacional | Legítimo interesse | igual ao fato |
| Notificações | e-mail | usuários | alertas contratados | Execução de contrato | envio + 90 d |

*Candidatas para o Controlador avaliar — **não** aplicadas automaticamente.

## 4. Direitos dos titulares — fluxo operacional
Canal: o titular procura o **Controlador**; o admin do tenant usa as ferramentas do doc 10 §3;
pedidos que chegarem direto ao DashSGS são redirecionados ao Controlador em 48 h com cópia do
material técnico. SLA interno: 72 h úteis para gerar relatórios/exclusões.

## 5. Transferência internacional
Padrão: hospedagem em região Brasil [RECOMENDAÇÃO]. Se qualquer suboperador processar fora
(ex.: SMTP), registrar no DPA com salvaguardas (cláusulas-padrão ANPD Res. 19/2024) —
[NECESSITA CONFIRMAÇÃO na escolha final de provedores].

## 6. RIPD/DPIA — gatilhos obrigatórios
1. Ativação do módulo Clientes por um tenant (template: descrição do fluxo, necessidade,
   riscos aos titulares, medidas — pré-preenchido pelo produto, assinado pelo Controlador).
2. Habilitação de escrita no ERP (risco de integridade de dados do Controlador).
3. Qualquer feature futura de benchmark/cross-tenant (também parecer jurídico).

## 7. Checklist LGPD de lançamento
[ ] DPA assinado com cada tenant · [ ] DPO designado e canal publicado · [ ] Política de
privacidade e aviso do app · [ ] ROPA vivo (revisão semestral) · [ ] Inventário de suboperadores ·
[ ] Processo de incidente testado (doc 27) · [x] Purge/offboarding testado (runbook 22 §3) ·
[ ] Treinamento de equipe (acesso mínimo, break-glass) · [x] Retenções implementadas como jobs ·
[ ] RIPD template pronto

Os dois itens marcados fecharam na Fase 9 (E6-04):

- **Retenções como jobs**: 21 políticas executáveis (doc 10 §8), rodada diária às 3h20, com
  verificação depois da purga. O estado se confere em `/plataforma/retencao` — a resposta certa
  é uma coluna de zeros — e em `retention_pending_rows` no Prometheus.
- **Purge/offboarding**: exclusão lógica com confirmação, carência de 30 dias, purga física por
  introspecção (toda tabela com `tenant_id`, inclusive as criadas depois) e comprovante de
  destruição na trilha append-only (`tenant.purged`, com linhas por tabela) — que é o registro
  que o art. 16 pede.

O break-glass do treinamento já existe em código (doc 07 §4.1): pedido com justificativa,
aprovação de segunda pessoa, prazo curto, aviso ao owner e relatório de acessos. Falta o
treinamento em si, que é processo, não software.
