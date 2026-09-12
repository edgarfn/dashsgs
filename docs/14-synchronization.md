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
