# 10 — Plano de Privacidade (Privacy by Design / Default)

Papéis LGPD: o **cliente do DashSGS (tenant)** é o **Controlador** dos dados do seu ERP;
o **DashSGS** atua como **Operador** (art. 5º VII), tratando conforme instruções contratuais
(DPA obrigatório no contrato — doc 28). Bases legais são responsabilidade do Controlador;
o que segue são os controles do Operador. **Não inventamos bases legais** — indicamos candidatas
para validação jurídica no doc 28.

## 1. Princípio operacional: minimizar na ingestão

A regra mais importante do produto: **o que não entra, não vaza**. A camada de sync descarta
campos não necessários ANTES de persistir. A API expõe muito mais PII do que o produto precisa.

### Política por recurso

| Recurso API | Política padrão DashSGS |
|---|---|
| Clientes (`/clientes`) | **NÃO sincronizado por padrão.** KPIs usam apenas `idCliente != 0` (contagem de vendas identificadas) sem resolver identidade. Módulo opcional "Clientes" (opt-in do Controlador com finalidade declarada) sincroniza subconjunto mínimo: id, nome, cpf_cnpj (hash + máscara), tipo, município, situação, data cadastro, limite. **Nunca**: endereço, telefone, celular, e-mail, gênero, nascimento, observações |
| Vendedores | id, nome, ativo, comissões, filial. CPF: armazenar **apenas máscara** (`***.***.NNN-NN`) p/ desambiguação; sem hash, sem completo |
| Vendas | `idCliente` bruto só com módulo Clientes ativo; senão persistir apenas flag `identificada` |
| `integracoes.mercafacil.cpfcnpj` | **Descartado sempre** (dado de terceiro sem finalidade nossa) |
| Usuários do ERP em strings (`usuario`, `usuarioGravacao`, `aprovadoPor`) | Persistidos (necessários p/ investigação de divergência operacional), classificados PERSONAL_DATA, acesso a partir do papel manager |
| Fornecedores/Filiais (PJ) | CNPJ/razão social persistidos (dado empresarial) |
| Chave NF-e | SECURITY_SENSITIVE; persistida apenas se relatório fiscal habilitado; acesso admin |

## 2. Matriz DADO → ciclo de vida

| Dado | Finalidade | Necessidade | Armazenamento | Retenção | Acesso | Proteção | Descarte |
|---|---|---|---|---|---|---|---|
| E-mail/nome usuário DashSGS | Conta e autenticação | Essencial | app_users | Vida da conta + 6 meses | próprio, admin do tenant | Hash de senha, TLS, RLS n/a | Purge job |
| Sessões (IP, UA) | Segurança de sessão | Essencial | app_sessions | 90 dias | próprio, auditor | — | TTL |
| Auditoria (ator, IP, ação) | Accountability (art. 6º X) | Essencial | app_audit_log | 5 anos | admin, auditor | Append-only, hash chain | Purge após retenção |
| Credencial ERP | Operar integração | Essencial | app_erp_connections | Vigência do contrato | ninguém (write-only) | AES-256-GCM, cofre de chave | Destruição no offboarding |
| Vendas (cupom/itens) | Analytics do Controlador | Essencial | erp_venda_* | 26 meses (config por tenant; comparativo anual) | papéis do tenant | RLS, partições | Drop de partição |
| Resumo diário/agregados | KPIs de longo prazo | Essencial | agg_* | 5 anos | papéis do tenant | RLS | Purge |
| Clientes (módulo opt-in) | CRM/crédito do Controlador | Opcional | erp_clientes | Enquanto módulo ativo | manager+ | RLS, máscara CPF, view mascarada | Purge em 30 dias ao desativar módulo |
| Vendedores | Análise de venda por vendedor | Importante | erp_vendedores | Vida do vínculo + 12 meses | papéis do tenant | Máscara CPF | Purge |
| Financeiro (contas, despesas, cartões) | Analytics financeiro | Essencial | erp_contas_*, erp_despesas, erp_cartao_vendas | 5 anos (prática fiscal BR) | manager+ | RLS | Purge |
| Logs de aplicação | Diagnóstico | Essencial | Loki | 30 dias (app), 90 dias (segurança) | equipe plataforma | Redaction PII/segredos | TTL |
| Métricas de chamada SG | Capacidade/faturamento | Importante | sync_api_call_log | 30 dias | plataforma | Sem payload | TTL |
| Backups | Continuidade | Essencial | storage externo | 35 dias (doc 20) | plataforma (break-glass) | Cifrados | Expiração automática |
| Eventos de alerta | Histórico do que o produto avisou | Importante | app_alert_events | 12 meses (decisão de produto, Fase 9) | papéis do tenant | RLS, sem PII | Purge job |
| Notificações enviadas | Comprovante de envio | Importante | app_notifications | 6 meses (decisão de produto, Fase 9) | papéis do tenant | RLS | Purge job |
| Concessões de break-glass | Accountability do acesso excepcional | Essencial | app_break_glass_grants | segue a auditoria (5 anos) | plataforma, auditor | Justificativa, prazo, contagem de acessos | Purge com o tenant |

## 3. Direitos dos titulares (suporte ao Controlador)

O DashSGS, como Operador, fornece ferramentas para o Controlador atender titulares:

| Direito | Ferramenta |
|---|---|
| Confirmação/acesso (art. 18 I-II) | Busca por hash de CPF no módulo Clientes → relatório dos dados mantidos |
| Correção (III) | Não aplicável diretamente: dado nasce no ERP; corrigir lá e ressincronizar (botão "ressincronizar cliente") |
| Anonimização/eliminação (IV, VI) | Exclusão do espelho + supressão em sync futuro (lista de supressão por hash) — não afeta o ERP do Controlador |
| Portabilidade (V) | Export CSV/JSON dos dados do titular |
| Informação sobre compartilhamento (VII) | DashSGS não compartilha com terceiros; declaração no DPA; suboperadores listados (hosting, e-mail) |

Prazo interno de atendimento ao Controlador: 72 h úteis para gerar o material.

## 4. Técnicas aplicadas

- **Pseudonimização**: CPF/CNPJ de clientes vira `sha256(pepper || doc)` para busca + máscara
  para exibição; pepper fora do banco.
- **Anonimização em telemetria**: métricas internas do produto nunca carregam PII, só contagens
  por tenant.
- **Minimização estrutural**: mapeadores da integração têm allowlist de campos; campo novo da API
  não entra sozinho no banco.
- **Privacy by Default**: módulo Clientes desligado; retenção padrão mínima; exports com máscara
  por padrão (desmascaramento é permissão explícita + auditada).
- **DPIA/RIPD**: exigido antes de ativar o módulo Clientes para um tenant e antes da fase de
  escrita no ERP (template no doc 28).

## 5. O que o DashSGS se compromete a NUNCA fazer

1. Vender/compartilhar dados de tenants ou titulares.
2. Cruzar dados entre tenants (nem para "benchmark" sem contrato e anonimização robusta k≥20 —
   e somente como feature opt-in futura, com parecer jurídico).
3. Persistir `senha`, tokens, `mercafacil.cpfcnpj`, gênero e nascimento de consumidores.
4. Logar payloads com PII.
5. Usar dados de produção em ambientes de teste (doc 17: dados sintéticos).

## 8. Estado da implementação (Fase 9 — E6-04)

A matriz do §2 deixou de ser só um compromisso escrito: virou um catálogo executável em
`apps/api/src/modules/retencao/politicas.ts`, com 23 políticas. **A mesma lista** é usada para
apagar e para conferir — não existe a possibilidade de uma purga que "esqueceu" uma linha da
tabela, porque quem verifica lê o mesmo arquivo que quem apaga.

| Peça | Onde |
|---|---|
| Catálogo (tabela, coluna de data, prazo, origem, motivo) | `modules/retencao/politicas.ts` |
| Purga em lotes + verificação | `modules/retencao/retencao.service.ts` |
| Offboarding físico (doc 08 §5) | `modules/retencao/offboarding.service.ts` |
| Rodada diária (03h20 America/Sao_Paulo) | `sync-scheduler.service.ts` → worker |
| Painel e botão de antecipar | `/plataforma/retencao` (platform_admin) |
| Métricas | `retention_pending_rows`, `retention_rows_purged_total`, `retention_last_run_timestamp_seconds` |

**O critério de aceite é "verify-purge zero"**: depois da purga, contar o que deveria ter sido
apagado tem de dar zero em todas as políticas. É isso que o teste de integração cobra, o que o
painel mostra e o que o gauge publica — qualquer valor acima de zero por mais de um dia significa
retenção prometida e não cumprida.

### Decisões tomadas na implementação

- **Mês é calendário, não 30 dias.** 26 meses antes de 31/03 é 31/01. Contar em dias erraria o
  corte por quase uma semana ao ano — sempre para o lado de guardar mais do que se prometeu.
- **A retenção de vendas é por contrato** (`app_tenants.retention_sales_months`, padrão 26): o
  cliente que quiser menos consegue menos, e a purga respeita o número dele.
- **Linha com data nula nunca vence.** Não dá para provar que expirou o que não tem data; o
  caminho dessas linhas é o offboarding, não o relógio.
- **A auditoria continua append-only** — a exceção da retenção mora no banco, não no código: a
  trigger aceita `DELETE` apenas quando o sinalizador `app.audit_purge` está ligado na transação
  **e** a linha passou dos cinco anos. Quem liga o sinalizador é `app_purge_audit_log()`, uma
  função `SECURITY DEFINER` com o prazo fixo dentro dela. O papel da aplicação segue sem
  privilégio de `DELETE` na tabela: ainda que alguém escreva o comando, o Postgres recusa antes
  da trigger.
- **Duas políticas nasceram aqui** (não estavam no §2): eventos de alerta (12 meses) e
  notificações (6 meses). Foram para a tabela do §2 como decisão de produto da Fase 9.
- **Clientes e vendedores ficaram de fora do catálogo** porque as tabelas ainda não existem — o
  módulo Clientes é opt-in e chega depois. Quando chegarem, entram como mais duas linhas.
