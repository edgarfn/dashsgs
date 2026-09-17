# 05 — Especificação de Banco de Dados

PostgreSQL 17. Três áreas lógicas no mesmo schema (`app`, prefixos): **app_** (produto),
**erp_** (espelho normalizado da API SG), **agg_** (agregados). Todas as tabelas de dados de
tenant carregam `tenant_id UUID NOT NULL` com **RLS** (doc 08).

Convenções: PK `id UUID default gen_random_uuid()` para tabelas de app; espelhos ERP usam PK
composta natural `(tenant_id, erp_id[, filial_erp_id])`; `created_at/updated_at timestamptz`;
`synced_at` nos espelhos; sem soft delete em espelhos (o ERP é a fonte de verdade — ressincroniza);
soft delete (`deleted_at`) apenas em `app_users`, `app_tenants`, `app_alert_rules`.

## 1. Núcleo do produto (app_)

```
app_tenants(id PK, name, slug UNIQUE, status[active|suspended], plan, created_at, deleted_at)

app_erp_connections(id PK, tenant_id FK→app_tenants UNIQUE,     -- 1 conexão por tenant (MVP)
  base_url, is_sg_cloud bool, auth_path_override nullable,
  username, secret_ciphertext bytea, secret_key_version int,     -- senha cifrada (envelope AES-256-GCM)
  tls_mode[https|vpn|http_forbidden], status[pending|ok|error],
  last_token_expires_at, last_health_at, health_payload jsonb,   -- GET /status
  routes_granted text[],                                         -- claim routes do último token
  created_at, updated_at)

app_users(id PK, email UNIQUE, password_hash (argon2id), name,
  totp_secret_ciphertext nullable, totp_enabled bool, status, last_login_at,
  failed_attempts int, locked_until, created_at, deleted_at)

app_memberships(id PK, user_id FK, tenant_id FK, role[owner|admin|manager|analyst|viewer|auditor],
  filiais_allowed int[] nullable,        -- NULL = todas as filiais do tenant
  UNIQUE(user_id, tenant_id))

app_sessions(id PK (token hash), user_id FK, tenant_id nullable, ip inet, user_agent,
  created_at, expires_at, revoked_at, mfa_passed bool)

app_password_resets(id PK, user_id FK, token_hash, expires_at, used_at)

app_audit_log(id bigserial PK, tenant_id, user_id nullable, session_id nullable,
  action, resource_type, resource_id, result[success|denied|error],
  ip, user_agent, changes jsonb,        -- diffs relevantes; NUNCA senhas/tokens
  prev_hash bytea, entry_hash bytea,    -- encadeamento hash (tamper-evidence)
  created_at)  -- APPEND-ONLY: sem UPDATE/DELETE (revogar privilégios + trigger)

app_alert_rules(id PK, tenant_id, name, type[ruptura|estoque_negativo|vencimento|perda|
  divergencia_fechamento|conta_vencendo|meta_atingimento|custom_sql_TEMPLATE],
  params jsonb, severity, channels jsonb, enabled bool, created_by, created_at, deleted_at)

app_alert_events(id PK, tenant_id, rule_id FK, filial_erp_id nullable, dedupe_key,
  payload jsonb, status[open|acknowledged|resolved], created_at, acked_by, acked_at,
  UNIQUE(tenant_id, rule_id, dedupe_key))

app_notifications(id PK, tenant_id, user_id, alert_event_id nullable, channel, status,
  sent_at, error)

app_erp_action_requests(id PK, tenant_id, type[oferta|pedido_compra|pedido_venda|acerto_estoque|
  gtin|baixa_cartao], payload jsonb, status[draft|pending_approval|approved|executing|done|failed|
  rejected], requested_by, approved_by nullable, erp_response jsonb, erp_entity_id nullable,
  correlation_id UNIQUE,               -- vira idPedidoIntegrador quando aplicável
  created_at, executed_at)
```

## 2. Sincronização (sync_)

```
sync_watermarks(tenant_id, domain, filial_erp_id nullable, watermark_date date nullable,
  watermark_ts timestamptz nullable, cursor jsonb, status[idle|running|error],
  last_success_at, last_error, PK(tenant_id, domain, coalesce(filial_erp_id,0)))

sync_job_runs(id bigserial PK, tenant_id, domain, filial_erp_id, started_at, finished_at,
  status, pages int, items int, api_calls int, error, duration_ms)

sync_api_call_log(id bigserial PK, tenant_id, endpoint, method, http_status, duration_ms,
  items int, called_at)   -- SEM payloads (privacidade); métricas apenas; retenção 30 dias
```

## 3. Espelho do ERP (erp_) — chaves naturais compostas

Dimensões (upsert integral):
```
erp_filiais(tenant_id, erp_id, razao_social, cnpj, municipio_erp_id, synced_at,
  PK(tenant_id, erp_id))
erp_departamentos_n1..n6(tenant_id, erp_id, descricao, parent_next_level_erp_id, ...)
erp_marcas / erp_classes / erp_agrupamentos / erp_unidades_medida(tenant_id, erp_id, descricao...)
erp_motivos_acerto / erp_motivos_perda / erp_motivos_troca(tenant_id, erp_id, descricao)
erp_municipios(tenant_id, erp_id, nome, uf, id_ibge)
erp_formas_pagamento(tenant_id, erp_id, descricao, vista_prazo, recebimento)
erp_compradores(tenant_id, erp_id, nome)
erp_vendedores(tenant_id, erp_id, nome, cpf_masked, filial_erp_id, comissao_vista,
  comissao_prazo, ativo, dias_rota text[])      -- cpf armazenado mascarado ***.***.NNN-NN; ver doc 10
erp_fornecedores(tenant_id, erp_id, razao_social, cnpj, dias_previsao_entrega)
erp_pdvs(tenant_id, filial_erp_id, erp_id, tipo, tipo_emissor, inativo, data_inativado)
erp_rotas_entrega / erp_prazos_pagamento / erp_tipos_clientes / erp_series ...
```

Produtos e satélites:
```
erp_produtos(tenant_id, erp_id, filial_erp_id,     -- cadastro pode variar por filial (custos/estoque)
  descricao, dep1_erp_id, marca_erp_id, classe_erp_id, agrup_erp_id, ativo,
  custo_real, custo_fiscal, custo_com_encargos, custo_medio, preco_custo,
  preco_venda1, preco_venda2, estoque_atual, estoque_minimo, estoque_maximo, estoque_trocas,
  balanca, unidade_medida, ultimo_fornecedor_nome, curva_abc, venda_media_diaria,
  qtd_emb_ultima_entrada, data_cadastro, data_alt_preco, data_alt_custo, data_alt_cadastro,
  synced_at, PK(tenant_id, filial_erp_id, erp_id))
erp_gtins(tenant_id, produto_erp_id, gtin, qtd_por_embalagem, PK(tenant_id, gtin))
erp_produto_fornecedores(tenant_id, produto_erp_id, fornecedor_erp_id, ipi, qtd_embalagens,
  principal bool)
erp_precos(tenant_id, produto_erp_id, filial_erp_id, preco_id, preco_venda, qtd_atacado, ...)
erp_ofertas(tenant_id, erp_id_trim, descricao, prioridade, tipo, somente_fidelizado)
erp_oferta_produtos(tenant_id, oferta_erp_id, filial_erp_id, produto_erp_id, data_inicial,
  data_final, preco, gtin, quantidade, desconto_fidelizado)
erp_vencimentos(tenant_id, filial_erp_id, produto_erp_id, data_vencimento, lote, qtd_lote,
  entrada_erp_id)
```

Fatos (particionados por RANGE em data; sub-partição/índice por tenant):
```
erp_vendas_cupons(tenant_id, filial_erp_id, data, caixa, cupom, serie_nfc, horario,
  cliente_erp_id,           -- armazenado APENAS se módulo clientes habilitado; senão NULL + flag identificada bool
  vendedor_erp_id, cancelada, valor_total, is_realtime bool, synced_at,
  PK(tenant_id, filial_erp_id, data, caixa, cupom))
erp_venda_itens(…FK cupom…, ordem, produto_erp_id, gtin, quantidade, preco_venda,
  desconto, acrescimo, cancelado, oferta_erp_id, pedido_venda_erp_id,
  icms_base, icms_aliq, icms_valor, pis_base, cofins_base, [pis/cofins aliq/valor nullable],
  tipo_tributacao, modelo_doc, beneficio_fiscal)
erp_finalizadora_lancamentos(tenant_id, filial_erp_id, data, caixa, cupom, especie, valor,
  cancelada, is_realtime)
erp_filial_venda_resumo(tenant_id, filial_erp_id, data, valor, custo_real, custo_sem_icms,
  custo_com_encargos, custo_medio, custo_fiscal_medio, aliq_media_icms, aliq_media_piscofins,
  qtd_clientes, qtd_unidades, prod_com_venda, prod_estoque_abaixo_min, prod_estoque_negativo,
  prod_estoque_sem_venda, margem_acima, margem_abaixo, margem_negativa,
  atualizou_estoque, gerou_vendas_diaria, exportou_vendas, processou_scanntech,
  possui_divergencia, usuario_atualizou_estoque, PK(tenant_id, filial_erp_id, data))
erp_produto_vendas_dia(tenant_id, filial_erp_id, produto_erp_id, data, quantidade, valor,
  preco_medio, custos jsonb, oferta_erp_id)
erp_perdas(tenant_id, filial_erp_id, produto_erp_id, data, quantidade, valor, motivo_erp_id)
erp_trocas / erp_movimentacoes (análogas, com tipo/cancelado)
erp_contas_pagar(tenant_id, erp_id, id_baixa, data_emissao, totais…,)
erp_conta_pagar_parcelas(…, tipo_entidade, entidade_erp_id, valor_doc, valor_pago, saldo,
  data_venc, data_pgto, status, ordem, tipo_lancamento)
erp_contas_receber / erp_conta_receber_parcelas (análogas + juros/desconto/pdv_baixa)
erp_despesas(tenant_id, filial_erp_id, tipo_despesa_erp_id, fornecedor_erp_id, data_despesa,
  data_emissao, data_processamento, sequencia, valor, classificacao, fechamento_caixa,
  usuario_erp, observacao)
erp_tipos_despesa(tenant_id, erp_id, descricao, classificacao, origem, tipo_custo, dep1_erp_id, …)
erp_cartao_vendas(tenant_id, filial_erp_id, chave_venda, nsu, data_venda, data_vencimento,
  valor_bruto, taxa_pct, tipo_venda, forma_pagamento, bandeira_cod, bandeira_desc,
  adquirente_desc, empresa_sg_cod, parcela, baixada bool)
erp_pedidos_compra(tenant_id, erp_id, id_pedido_integrado, fornecedor_erp_id, filial_erp_id,
  comprador_erp_id, datas…, situacao, valor_total, valor_frete, status_integrado)
erp_pedido_compra_itens / erp_pedido_compra_distribuicao
erp_pedidos_venda(tenant_id, filial_erp_id, erp_id, id_externo, cliente_erp_id?, datas…,
  valor_total, cancelado, id_substituido, …)
erp_notas_entrada / erp_nota_entrada_itens / erp_notas_saida / erp_nota_saida_itens
  (campos fiscais completos; chave_nfe char(44) SECURITY_SENSITIVE — acesso restrito)
erp_nfs / erp_nfs_servicos
erp_verbas / erp_verba_parcelas / erp_verba_pagamentos / erp_verba_eventos
erp_previsao_vendas(tenant_id, filial_erp_id, competencia[date, dia 1 do mês],
  previsao_venda, previsao_lucro, dias_uteis, PK(tenant_id, filial_erp_id, competencia))
erp_previsao_vendas_diaria(tenant_id, filial_erp_id, data, previsao_venda,
  PK(tenant_id, filial_erp_id, data))   -- a curva; opcional no ERP
erp_clientes  -- SOMENTE se feature habilitada pelo tenant (doc 10): campos minimizados
  (tenant_id, erp_id, nome, cpf_cnpj_hash, cpf_cnpj_masked, tipo_principal, municipio_erp_id,
   situacao, data_cadastro, limite_compras, filial_erp_id)  -- sem endereço/telefone/email/gênero/nascimento
```

## 3. Agregados (agg_) — materializados por worker

```
agg_vendas_hora(tenant_id, filial_erp_id, data, hora, valor, cupons, itens)         -- do tempo real
agg_vendas_dia_dep(tenant_id, filial_erp_id, data, dep1_erp_id, valor, quantidade, custo, margem)
agg_meta_atingimento(tenant_id, filial_erp_id, ano, mes, dia, venda_acum, meta_mes, pct)
agg_financeiro_aging(tenant_id, data_ref, tipo[pagar|receber], bucket[vencido|d7|d30|d90|d90p],
  valor)
agg_cartoes_taxas(tenant_id, filial_erp_id, mes, bandeira, adquirente, valor_bruto, taxa_media,
  valor_taxas)
```

## 4. Índices e constraints essenciais

- Todos os espelhos: índice `(tenant_id, synced_at)`; fatos: `(tenant_id, filial_erp_id, data)`.
- `erp_venda_itens (tenant_id, produto_erp_id, data)` p/ drill de produto.
- `erp_cartao_vendas (tenant_id, nsu, data_venda)`; UNIQUE `(tenant_id, chave_venda)`.
- CHECKs de enum nas colunas de status/situação normalizadas.
- FKs dentro do espelho **não** são declaradas contra o ERP (dados podem chegar fora de ordem);
  integridade referencial garantida por reconciliação de sync, FKs reais apenas nas tabelas app_.
- Particionamento: `erp_venda_itens`, `erp_vendas_cupons`, `erp_finalizadora_lancamentos`,
  `erp_movimentacoes` por mês (RANGE data). Retenção conforme doc 10.

## 5. ERD textual (resumo)

```
app_tenants 1─1 app_erp_connections
app_tenants 1─N app_memberships N─1 app_users
app_tenants 1─N erp_filiais 1─N erp_pdvs
erp_filiais 1─N erp_filial_venda_resumo
erp_filiais 1─N erp_vendas_cupons 1─N erp_venda_itens N─1 erp_produtos
erp_produtos N─1 erp_departamentos_n1 (…n2..n6 em cadeia)
erp_produtos 1─N erp_gtins / erp_precos / erp_vencimentos / erp_produto_fornecedores N─1 erp_fornecedores
erp_pedidos_compra 1─N erp_pedido_compra_itens; 1─N erp_pedido_compra_distribuicao N─1 erp_filiais
erp_contas_pagar 1─N erp_conta_pagar_parcelas (idem receber)
erp_verbas 1─N erp_verba_parcelas 1─N erp_verba_pagamentos; N─1 erp_verba_eventos
app_alert_rules 1─N app_alert_events 1─N app_notifications
app_erp_action_requests N─1 app_users (requested_by/approved_by)
```

## 5.1 Estado da implementação (Fase 2)

A migração inicial (prisma/migrations/*_init) criou o núcleo de identidade — app_tenants,
app_users, app_memberships, app_sessions, app_password_resets, app_audit_log — mais a
infraestrutura de isolamento que as próximas fases consomem:

- funções app_current_tenant_id(), app_required_tenant_id() e app_current_user_id();
- procedure app_enable_tenant_rls(tabela): template ESTRITO (sem app.tenant_id a consulta falha)
  — obrigatório para toda tabela erp_/agg_/sync_ criada da Fase 4 em diante;
- procedure app_enable_identity_rls(tabela): template das tabelas lidas antes de haver tenant
  escolhido (login), já aplicado a app_memberships, app_sessions e app_audit_log;
- app_audit_log com UPDATE/DELETE revogados de app_rw e triggers que bloqueiam os dois.

As tabelas erp_, agg_ e sync_ descritas acima ainda não existem: entram com os épicos E4–E5.

## 5.2 Estado da implementação (Fases 5 e 6)

| Grupo | Tabelas criadas |
|---|---|
| Conexão (E4) | `app_erp_connections` |
| Sync (E5-01) | `sync_watermarks`, `sync_job_runs`, `sync_api_call_log` |
| Dimensões (E5-02) | `erp_filiais`, `erp_departamentos_n1..n6`, `erp_marcas`, `erp_classes`, `erp_agrupamentos`, `erp_unidades_medida` |
| Produtos (E5-03) | `erp_produtos`, `erp_gtins` |
| Vendas (E5-04/05) | `erp_vendas_cupons`, `erp_venda_itens`, `erp_finalizadora_lancamentos` |
| Resumo (E5-06) | `erp_filial_venda_resumo` |
| Agregados (E5-08) | `agg_vendas_hora`, `agg_vendas_dia_dep` |

Todas com RLS estrita (`app_enable_tenant_rls`) e conferidas pelo gate `pnpm db:rls-check`.

Decisões tomadas na implementação:

- **Sem FK contra `app_tenants`** nas tabelas `erp_`/`agg_`/`sync_`, como manda o §4: os ids vêm
  do ERP e chegam fora de ordem. O isolamento é da RLS; a purga do offboarding (E6-04) apaga por
  `tenant_id` explicitamente.
- **Ids de dimensão são texto** (`VARCHAR(20)`): o ERP mistura id numérico (marcas,
  departamentos) com código (`"UN"`, `"KG"` em unidades de medida). Guardar como número
  quebraria no primeiro cadastro que usa letra.
- **Dinheiro em `numeric(14,4)`**, e o valor viaja do mapper até o banco como texto decimal com
  cast explícito (ver `upsert-lote.ts`) — nenhum float no caminho.
- **`filial_erp_id = 0`** em `sync_watermarks` é o "sem recorte por filial" que o §2 descreve
  como `coalesce(filial_erp_id, 0)`: o zero cabe na PK, o NULL não.

Ainda não implementado deste doc: o **particionamento por mês** dos fatos (§4). O gate de drift
compara migrações com o schema do Prisma, que não modela partições — fazer isso agora exigiria
tirar as tabelas do controle do ORM. Entra com E6-04 (retenção/purga), que é onde as partições
começam a pagar. Também faltam os espelhos de notas fiscais e o resto de E5-10 (perdas, trocas,
vencimentos e movimentações).

## 5.3 Estado da implementação (Fases 8 a 11)

| Grupo | Tabelas criadas |
|---|---|
| Financeiro (E5-09) | `erp_contas_pagar` + parcelas, `erp_contas_receber` + parcelas, `erp_tipos_despesa`, `erp_despesas`, `erp_cartao_vendas` |
| Compras (E5-10 parcial) | `erp_pedidos_compra`, `erp_notas_entrada` |
| Alertas (E8) | `app_alert_rules`, `app_alert_events`, `app_notifications` |
| Retenção/acesso (E6-04, E9-03) | `app_break_glass_grants` |
| Previsão (E5-11) | `erp_previsao_vendas`, `erp_previsao_vendas_diaria` |

Duas mudanças de forma em relação ao esboço do §3, ambas da previsão de vendas:

- **A competência virou `date` (dia 1 do mês)** em vez do par `(ano, mes)`. É a única forma que
  compara com a `data` do resumo diário sem conversão em toda consulta — e é o mesmo índice que
  responde "qual a meta deste mês?" e "como foram os últimos seis?".
- **A coluna `escopo` saiu, e a curva diária virou tabela própria.** Uma tabela que guarda ao
  mesmo tempo mês-por-filial e dia-por-filial precisa de `escopo` em toda cláusula — e uma
  consulta que esquece o filtro soma a curva com o total do mês e devolve o dobro, sem erro. Os
  recortes por departamento/marca/produto voltam quando alguma tela precisar deles; até lá,
  seriam coluna sem leitor.
## 6. Segurança do banco

- RLS em TODAS as tabelas com `tenant_id` (política `tenant_id = current_setting('app.tenant_id')::uuid`),
  detalhes no doc 08; papel da aplicação **sem** `BYPASSRLS`.
- `app_audit_log`: `REVOKE UPDATE, DELETE` de todos os papéis; trigger que bloqueia alteração;
  encadeamento `entry_hash = sha256(prev_hash || linha)` para evidência de adulteração.
- Colunas cifradas: `secret_ciphertext`, `totp_secret_ciphertext` (AES-256-GCM, chave via env/KMS,
  versão de chave para rotação).
- `chave_nfe` e `cpf_cnpj_*`: acesso via view com máscara para papéis não-admin.
- Backups cifrados (doc 20).
