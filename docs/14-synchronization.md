# 14 — Estratégia de Sincronização e Cache

## 1. Princípios

1. **Pull-only** (a API não tem webhooks) com watermarks por (tenant, domínio, filial).
2. **Idempotência total**: todo write no espelho é UPSERT por chave natural; rodar duas vezes o
   mesmo período não duplica nada.
3. **Nunca degradar o ERP do cliente**: self-rate-limit, janelas de backfill configuráveis,
   prioridade tempo-real > incremental > backfill.
4. **Falha isolada**: erro em um domínio/filial não bloqueia os demais; retry com backoff;
   watermark só avança em sucesso.
5. **Fonte de verdade é o ERP**: divergência → ressincronizar, nunca "consertar na mão".

## 2. Cadências (padrão; configuráveis por tenant)

| Grupo | Endpoints | Cadência | Estratégia |
|---|---|---|---|
| Tempo real | /vendas/hoje, /vendas/finalizadoras/hoje | 5 min (horário de loja) | Full do dia corrente, upsert com `is_realtime=true` |
| Fechamento | /filiais/vendas (dia anterior), /vendas?data=D-1, /vendas/finalizadoras?data=D-1 | A cada 30 min entre 20h–08h até detectar `gerouVendasDiaria=true`; então 1x consolidação | Substitui registros realtime do dia (delete+insert transacional do dia) |
| Produtos incremental | /produtos com filtroDataTipo=dataAlteracaoCadastro/Preco/Custo | 30 min | 3 varreduras incrementais por watermark de data; upsert |
| Estoque/preço satélites | /produtos/precos, /produtos/ofertas, /produtos/gtins | 6 h (precos/ofertas), 24 h (gtins) | Full paginado (sem timestamp de alteração — [DOCUMENTADO]) |
| Dimensões leves | filiais, departamentos 1–6, marcas, classes, agrupamentos, unidades, municípios, motivos, formas/prazos/rotas, pdv, séries, vendedores, compradores, fornecedores | 24 h (madrugada) | Full (volumes pequenos) |
| Séries operacionais | movimentacoes, perdas, trocas, vencimentos | 1–6 h (janela D-2..D para pegar retroativos) | Janela deslizante ≤30 dias |
| Financeiro | contas/pagar, contas/receber, despesas | 1 h (D-3..D+90 vencimentos) | Janela deslizante por dataEmissao + reconciliação semanal do aberto |
| Cartões | /vendascartoes | 1 h (D-7..D) | Upsert por chaveVenda |
| Compras | pedidoscompra (+produtos/distribuição dos pedidos abertos), entradas | 1 h | Incremental por data + refresh dos pedidos não-atendidos |
| Notas | entradas, saidas, nfs (+ itens sob demanda) | 6 h | Incremental por data |
| Previsão | previsaovendas (+recortes) | 24 h (mês corrente e próximo) | Full do mês |
| Verbas | verbas, eventos, pagas | 24 h | Janela mensal |
| Health | GET /status + POST autorizacao | 10 min | Atualiza status da conexão |

## 3. Primeira sincronização (backfill)

1. Health + captura de `routes_granted` → habilita módulos possíveis.
2. Dimensões completas.
3. Fatos históricos **de trás para frente** em fatias de 30 dias (limite documentado) ou 1 dia
   (`/vendas`), começando pelos últimos 90 dias (dashboard utilizável rápido), continuando até a
   profundidade contratada (padrão 26 meses) em janela noturna.
4. Agregados recalculados por fatia concluída; progresso visível na UI de onboarding.
5. Orçamento de chamadas: estimativa por filial ~ (dias × 3 endpoints de venda) + paginação;
   limitado por `maxRps` — para 2 anos × 5 filiais ≈ dezenas de milhares de chamadas → diluir em
   noites [RECOMENDAÇÃO operacional].

## 4. Detecção de mudança e reconciliação

- Produtos: watermarks pelos 3 tipos de data de alteração [DOCUMENTADO].
- Fatos por data: janela deslizante cobre lançamentos retroativos (ex.: baixa de conta antiga →
  reconciliação semanal de títulos com `status=naoPagas` re-consultados por id).
- `possuiDivergencia`/flags do resumo diário: disparam re-sync do dia afetado + alerta.
- Checksum leve: contagem `quantidadeItens` da paginação comparada ao espelho por
  domínio×período; divergência > tolerância → re-sync da janela + métrica.
- Cancelamentos: vendas com `cancelada=true` e situações "C/R/..." são persistidas com o status
  (não deletadas) — dashboards filtram; histórico auditável.

## 5. Concorrência e resiliência

- Lock por (tenant, domínio): nunca duas execuções simultâneas do mesmo escopo.
- Paralelismo por tenant limitado (2 domínios simultâneos) e global (pool de workers).
- Backoff em falha do job: 1 min → 5 → 15 → 60; após 5 falhas: pausa domínio + alerta.
- Circuit breaker do cliente HTTP (doc 12) pausa todos os domínios do tenant.
- Relógio: agenda em timezone do tenant (`America/Sao_Paulo` default); cuidado com DST.
- Reprocesso manual (runbook 22): re-sync por tenant/domínio/período com um comando.

## 6. Cache (leitura do dashboard)

| Item | TTL | Chave | Invalidação |
|---|---|---|---|
| KPIs do dia (tempo real) | 60 s | `t:<id>:kpi:today:<filial>` | TTL + após sync tempo-real |
| Consultas de dashboards históricos | 15 min | `t:<id>:q:<hash-normalizado>` | TTL + `sync.domain.completed` do domínio envolvido |
| Dimensões (nomes p/ filtros) | 12 h | `t:<id>:dim:<tipo>` | Após sync de dimensões |
| Token SG | 50 min | `sgtoken:<id>` | 401 → invalida |
| Sessões | 5 min (cache do lookup) | `sess:<hash>` | Revogação escreve tombstone |

Regras: **toda** chave com prefixo do tenant (doc 08); nunca cachear resposta com dados
desmascarados; nunca cachear erros; stampede protection (lock + stale-while-revalidate).

**Não cacheáveis**: credenciais/segredos (fora o token no Redis com TTL), trilha de auditoria,
resultados de verificação de permissão (avaliar sempre).

## 7. Consistência exposta ao usuário

- Cada painel exibe "dados de HH:MM" (`synced_at` do domínio) e badge "tempo real" vs
  "consolidado".
- Dia corrente pode divergir do consolidado pós-fechamento — comportamento documentado na UI
  (tooltip) para não parecer bug.

## 8. Estado da implementação (Fase 6)

| Spec | Implementação |
|---|---|
| §1 Watermarks por (tenant, domínio, filial) | `apps/api/src/modules/sync/watermark.service.ts` |
| §1 Idempotência por chave natural | `apps/api/src/modules/sync/upsert-lote.ts` |
| §2 Cadências | `packages/shared/src/sync.ts` + `queue/sync-scheduler.service.ts` |
| §2 Tempo real / fechamento | `domains/vendas-hoje.sync.ts` · `domains/vendas-dia.sync.ts` |
| §2 Produtos incremental (3 datas) | `domains/produtos.sync.ts` |
| §2 Dimensões | `domains/dimensoes.sync.ts` |
| §2 Resumo diário + flags | `domains/resumo-filial.sync.ts` |
| §3 Backfill resumível | `apps/api/src/modules/sync/backfill.service.ts` |
| §5 Lock por (tenant, domínio) | `apps/api/src/modules/sync/sync-lock.service.ts` |
| §5 Backoff 1/5/15/60 min + DLQ | `queue/sync.worker.ts` (BullMQ) |
| §7 Frescor exposto ao usuário | `apps/web/src/app/admin/sincronizacao` + `sync-status.service.ts` |
| Agregados por evento | `apps/api/src/modules/sync/aggregates.service.ts` |
| §2 Financeiro (contas, despesas, cartões) | `domains/financeiro.sync.ts` — janela −45/+90 dias, cadência de 1 h |
| §2 Compras (pedidos, entradas) | `domains/compras.sync.ts` — janela de 60 dias, cadência de 1 h |

Decisões tomadas na implementação:

- **Dia de venda é reescrito, não emendado.** Gravar é apagar o (filial, dia) e reinserir, numa
  transação. Upsert cego deixaria para trás o cupom que o ERP estornou — e faturamento fantasma é
  pior que um segundo de indisponibilidade do dia no espelho.
- **A consolidação espera o ERP declarar o fechamento** (`gerouVendasDiaria` no resumo diário).
  Antes disso, `/vendas?data=D` ainda muda, e um painel que alterna entre dois faturamentos
  destrói a confiança mais rápido que um painel atrasado.
- **A marca d'água só anda em sucesso, e nunca para trás.** O backfill processa fatias antigas
  sem puxar o incremental junto.
- **Domínio agendado por tick, não por tenant.** Um job repetitivo por domínio acorda, olha quem
  está ativo e enfileira — tenant novo entra na cadência sem ninguém registrar nada, e o número
  de agendamentos não cresce com a base.
- **Recurso que o ERP não tem não é erro.** Rota fora do contrato (ou 404) vira "pulado" com
  registro, e o resto do cadastro continua: uma rede que não usa agrupamentos não pode ficar sem
  marcas por causa disso.
- **O worker expõe `/metrics` numa porta própria** (`WORKER_PORT`): é nele que a sincronização
  acontece, e métrica que ninguém raspa não existe (doc 18 §2).
- **Backfill de trás para frente, com concorrência 1.** O dashboard fica utilizável em minutos, e
  a carga histórica nunca disputa o ERP da loja com o tempo real.

Ainda não implementado deste doc: perdas, trocas, vencimentos e movimentações (resto de E5-10),
notas de saída/NFS, verbas e previsão de vendas (E5-11), e a reconciliação por `quantidadeItens`
do §4 — hoje a divergência é detectada pela flag `possuiDivergencia` do resumo diário, que já
dispara re-sync do dia.