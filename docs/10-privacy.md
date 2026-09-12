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
