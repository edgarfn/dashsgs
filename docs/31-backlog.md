# 31 — Backlog Priorizado

Prioridades: P0 obrigatório MVP · P1 importante · P2 recomendado · P3 futuro.
Estado: ✅ concluído · ◐ parcialmente entregue.
Complexidade: P/M/G. Cada item herda o DoD do doc 24 §9. Critérios de aceite resumidos (CA).

## Épico E1 — Foundation (Fase 2) — **concluído**
| ID | História | Pri | Cx | Depende | CA |
|---|---|---|---|---|---|
| E1-01 ✅ | Monorepo pnpm + apps api/web + packages/shared | P0 | M | — | build+dev funcionam |
| E1-02 ✅ | CI completo com gates (lint, test, SAST, SCA, secrets, build, Trivy) | P0 | M | E1-01 | PR bloqueia conforme doc 11 §2 |
| E1-03 ✅ | Compose dev (pg, redis, mailpit) + seeds sintéticos | P0 | P | E1-01 | `pnpm dev` sobe tudo |
| E1-04 ✅ | Config por env com schema zod (falha rápida) | P0 | P | E1-01 | boot falha com env inválida |
| E1-05 ✅ | Logger estruturado + redaction + correlation id middleware | P0 | M | E1-01 | teste de redaction passa |
| E1-06 ✅ | Error handler global padronizado | P0 | P | E1-05 | corpo {code,message,correlationId,timestamp} |
| E1-07 ✅ | Deploy staging por digest + smoke | P0 | M | E1-02 | pipeline até staging |

### O que a Fase 2 deixou pronto

- **E1-01** — monorepo pnpm (apps/api, apps/web, packages/shared); build e dev verdes
- **E1-02** — .github/workflows/ci.yml: lint, typecheck, cobertura, Semgrep, osv-scanner+audit, gitleaks, build, integração com pg/redis, Trivy
- **E1-03** — docker/compose.dev.yml (pg 17, redis 7, mailpit) + prisma/seed.ts sintético
- **E1-04** — apps/api/src/config/env.schema.ts (zod, guardas de produção) — testado
- **E1-05** — nestjs-pino + redaction por nome de campo + correlação via AsyncLocalStorage
- **E1-06** — AllExceptionsFilter — corpo {code,message,correlationId,timestamp}, sem stack
- **E1-07** — deploy-staging.yml (imagem por digest + SBOM) + scripts/deploy.sh e smoke.sh

Decisões tomadas durante a implementação (não estavam na spec):

- `app_memberships`, `app_sessions` e `app_audit_log` usam o template `app_enable_identity_rls`:
  isolam por tenant quando há contexto e permitem leitura no fluxo de login, que acontece antes
  de existir um tenant escolhido. Dados de tenant (`erp_`/`agg_`/`sync_`) usarão
  `app_enable_tenant_rls`, que **falha** sem `app.tenant_id` definido — a Fase 4 aplica isso
  tabela a tabela (E3-02).
- `filiais_allowed` é array não-nulo com **vazio = todas as filiais** (o Prisma não modela array
  anulável, e ter dois jeitos de dizer "sem restrição" no banco seria pior).
- O modo `standalone` do Next é ligado por `NEXT_OUTPUT_STANDALONE=true` (Dockerfile), porque ele
  cria symlinks e quebraria `pnpm build` na máquina Windows de quem desenvolve.
- Cobertura unitária é medida sobre os módulos transversais (config, logging, errors,
  correlation, validation); serviços com I/O são cobertos pela suíte de integração. A régua de
  80% do doc 11 §2 acompanha a chegada de cada módulo core.

## Épico E2 — Autenticação (Fase 3) — **concluído**
| ID | História | Pri | Cx | Depende | CA |
|---|---|---|---|---|---|
| E2-01 ✅ | Modelo users/sessions + Argon2id + login/logout | P0 | M | E1 | testes authn |
| E2-02 ✅ | Rate limit login + lockout incremental | P0 | P | E2-01 | 429/lock testados |
| E2-03 ✅ | Recuperação e troca de senha (tokens single-use) | P0 | P | E2-01 | invalidação de sessões |
| E2-04 ✅ | MFA TOTP + códigos de recuperação | P0 | M | E2-01 | obrigatório p/ admin |
| E2-05 ✅ | Convites por e-mail (fluxo tenant) | P0 | M | E2-01, E3-01 | expira, single-use |
| E2-06 ✅ | Telas: login, MFA, reset, perfil, sessões ativas | P0 | M | E2-01..04 | E2E Playwright |
| E2-07 ✅ | Auditoria de eventos de autenticação | P0 | P | E2-01, E6-01 | eventos gravados |

### O que a Fase 3 deixou pronto

- **E2-01** — sessão server-side opaca (SHA-256 no banco), Argon2id 64 MiB/t=3/p=4, cookies
  `HttpOnly`+`SameSite=Lax` (prefixo `__Host-` em produção), expiração absoluta 12 h e
  inatividade 60 min com renovação deslizante.
- **E2-02** — rate limit por IP e por conta no Redis + bloqueio incremental (1→15 min) no banco.
- **E2-03** — recuperação por e-mail (token de uso único, 30 min) e troca com senha atual; as
  duas derrubam as demais sessões e avisam o dono da conta por e-mail.
- **E2-04** — TOTP (RFC 6238) com segredo cifrado em envelope AES-256-GCM, 10 códigos de
  recuperação de uso único e rotação do id de sessão ao concluir o segundo fator.
- **E2-05** — convites por e-mail vinculados a tenant+papel, com expiração de 72 h, uso único e
  recusa de escalada (admin não convida owner).
- **E2-06** — telas de login, desafio e cadastro de MFA, códigos de recuperação, recuperação e
  redefinição de senha, aceite de convite e perfil (senha, MFA, dispositivos conectados).
- **E2-07** — auditoria de todos os eventos de autenticação com encadeamento de hash.

Também entrou, porque a autenticação precisava: o guard central de RBAC com a matriz do doc 07
(parte de E3-01), a cifra de envelope reaproveitável pela credencial do ERP (base de E4-03) e o
encadeamento de hash da trilha (parte de E6-01).

Decisões e descobertas da implementação:

- O cookie anti-CSRF é `HttpOnly`: quem lê e reenvia o token é o BFF (servidor do Next), não
  script de página — o double-submit continua valendo e a superfície de XSS some.
- O middleware do front **não** redireciona `/entrar` para a home quando existe cookie. Cookie
  presente não é sessão válida; fazer isso criava um laço de redirecionamento exatamente para
  quem estava com a sessão revogada (bug encontrado pelo E2E).
- `zxcvbn` aceita `dashsgs2026dashsgs` (score 3). Mantivemos a régua do doc 06 em vez de criar
  regra de composição própria; se virar problema real, a mudança passa por ADR.
- A suíte inteira sai do mesmo IP e estouraria o próprio rate limit: os testes zeram os
  contadores entre cenários e há um cenário dedicado ao limite.

## Épico E3 — Multi-tenant & RBAC (Fase 4) — **concluído**
| ID | História | Pri | Cx | Depende | CA |
|---|---|---|---|---|---|
| E3-01 ✅ | Modelo tenants/memberships/papéis + guard RBAC | P0 | M | E2 | matriz doc 07 testada |
| E3-02 ✅ | RLS: template de migração + políticas + papéis de DB | P0 | G | E1 | introspecção no CI |
| E3-03 ✅ | Tenant-context (interceptor API + wrapper workers) | P0 | M | E3-02 | SET LOCAL comprovado |
| E3-04 ✅ | Suite de isolamento A→B gerada do router | P0 | M | E3-01..03 | 100% endpoints cobertos |
| E3-05 ✅ | Cache prefixado por tenant (helper + lint) | P0 | P | E3-03 | teste de prefixo |
| E3-06 ✅ | `filiais_allowed` fim-a-fim | P1 | M | E3-01 | testes de filial |
| E3-07 ✅ | Painel platform-admin básico (criar tenant/suspender) | P0 | M | E3-01 | runbook 22 §1/2 executável |

### O que a Fase 4 deixou pronto

- **E3-01** — gestão de membros do tenant (listar, trocar papel, ajustar filiais, remover) com
  regras duras: ninguém altera o próprio vínculo, só owner mexe em owner e o último owner não
  pode ser rebaixado nem removido.
- **E3-02** — dois templates de RLS em SQL (`app_enable_tenant_rls` estrito e
  `app_enable_identity_rls` para o fluxo de login) e a função `app_rls_gaps()`, que vira gate
  no CI (`pnpm db:rls-check`): tabela com `tenant_id` sem política quebra o build.
- **E3-03** — `TenantDatabase` como porta única de acesso a dado de tenant: abre transação,
  fixa `app.tenant_id`/`app.user_id` com `SET LOCAL` e oferece `runJob()` para os workers da
  Fase 6, cada job no seu próprio contexto de correlação.
- **E3-04** — suíte A→B **gerada do router**: toda rota registrada é classificada; as que têm
  id recebem ids do tenant vizinho (esperado 404/403) e as listagens são varridas atrás de
  qualquer marca do vizinho. Rota nova sem classificação quebra o teste.
- **E3-05** — cache sempre prefixado por tenant, com teste de prefixo e de purga isolada.
- **E3-06** — `filiais_allowed` fim-a-fim: validado no parâmetro (403 ao pedir filial fora do
  recorte) **e** aplicado na consulta (listagem sem parâmetro já vem recortada).
- **E3-07** — painel da plataforma: criar tenant já convidando o owner, suspender com motivo
  (derruba sessões e bloqueia login) e reativar — runbooks 22 §1 e §2 executáveis sem psql.

Entrou junto porque o isolamento precisava de dado real para ser exercido: a tabela
`erp_filiais` (primeira do espelho `erp_`) e o endpoint `GET /dim/filiais`. A sincronização com
a API SG continua sendo da Fase 6 (E5-02); por ora o seed popula filiais sintéticas.

Decisões e descobertas da implementação:

- Contas de plataforma (`platform_admin`) também exigem MFA, e o painel responde **404** para
  quem não é da operação: a existência da área não é assunto de quem não opera.
- Suspender precisou derrubar sessões por **membro**, não por `session.tenant_id`: sessão de
  quem ainda não escolheu tenant não carregava a marca e sobrevivia à suspensão (bug achado
  pelo teste de integração). O login passou a carimbar o tenant quando o vínculo é único.
- Os padrões de transação do Prisma (2 s/5 s) foram ampliados para 10 s/30 s: com toda leitura
  de tenant sendo transacional, o padrão falhava artificialmente sob concorrência.
- Ids de campo na UI passaram a ser únicos (`useId`): a mesma etiqueta se repete por linha na
  tela de acessos, e ids duplicados apontavam todos os rótulos para o primeiro campo.

## Épico E4 — Integração SG (Fase 5) — **concluído**
| ID | História | Pri | Cx | Depende | CA |
|---|---|---|---|---|---|
| E4-01 ◐ | Tipos + fixtures da coleção (todas as respostas doc 03) | P0 | M | — | zod schemas por recurso |
| E4-02 ✅ | Token manager (cache, lock, renovação, rotas) | P0 | M | E4-01 | testes de expiração/401 |
| E4-03 ✅ | Cofre de credencial (AES-GCM envelope + write-only UI) | P0 | M | E3 | DBA não lê; rewrap testado |
| E4-04 ✅ | Cliente HTTP: timeout/retry/backoff/rate-limit/breaker | P0 | G | E4-02 | políticas doc 12 §3 testadas |
| E4-05 ✅ | Mappers com allowlist + normalizações doc 12 §4 + quarentena | P0 | G | E4-01 | fixtures maliciosas tratadas |
| E4-06 ✅ | Anti-SSRF na configuração de base_url | P0 | P | E4-03 | payloads bloqueados |
| E4-07 ✅ | Wizard de conexão + health + rotas detectadas | P0 | M | E4-02..06 | conecta homologação SG |
| E4-08 ✅ | Testes de contrato nightly (homologação) | P1 | M | E4-07 | job agendado + alerta drift |
| E4-09 ✅ | Suporte VPN (tls_mode=vpn) — provisão manual documentada | P1 | M | E4-07 | runbook 22 §7 |

**E4-01 ficou parcial de propósito**: os tipos entregues cobrem os recursos que a Fase 6
sincroniza primeiro (status, filiais, dimensões, produtos, vendas dia/hoje, finalizadoras, resumo
diário). Os demais recursos do doc 03 entram com seus jobs de sync — schema sem consumidor
envelhece sem ninguém notar (doc 24 §7).

O que a Fase 5 deixou pronto:

- **Camada anti-corrupção completa** (`integration/sg`): token manager com cache Redis e lock de
  single-flight, cliente HTTP com timeout/retry-em-GET/backoff/rate-limit/circuit breaker,
  normalizadores das esquisitices documentadas (padding, `""` em data, "S"/" " como booleano,
  decimal com vírgula, três formatos de envelope de página) e catálogo tipado de operações.
- **Cofre de credencial do ERP** com a cifra de envelope da Fase 3, incluindo `rewrap` para
  rotação de chave; a senha nunca volta para a tela.
- **Guarda anti-SSRF** que resolve o DNS e recusa loopback, link-local/metadata, faixas privadas,
  CGNAT e reservadas — revalidando a cada chamada, não só no cadastro.
- **Wizard de conexão** com teste de conexão, estado (não testado/conectado/erro), versão do ERP e
  as rotas contratadas visíveis — é o contrato da SG que define quais painéis o produto pode
  oferecer.
- **Mocks fiéis** (`SG_MOCK=true`) que reproduzem os defeitos documentados da API, e contrato
  nightly contra a homologação para achar drift antes do cliente.

Decisões e descobertas da implementação:

- `prisma.upsert` avalia o payload de `create` mesmo quando vai atualizar: editar a conexão sem
  informar senha nova estourava `null.ciphertext`. Virou `update`/`create` explícitos (bug achado
  pelo teste de integração).
- O erro do ERP tem **duas audiências**: `SgError.message` carrega a mensagem de origem para log
  e Sentry; `toAppException()` devolve texto genérico ao usuário — repassar o texto do ERP
  entregaria detalhe de infraestrutura alheia a quem abriu a tela.
- A suíte de isolamento é gerada do router, e rotas novas sem parâmetro passavam sem declaração;
  o meta-teste passou a falhar nesses casos, além de ignorar artefatos do Nest (catch-all,
  âncora de prefixo) e tratar `/healthz|/readyz|/metrics` como infraestrutura.
- A faixa do túnel VPN saiu de constante no código para `SG_VPN_CIDR`: trocar a rede é decisão de
  operação (runbook 22 §7), não um deploy de código.
- O contrato nightly **pula com aviso** quando faltam os secrets, em vez de falhar: job vermelho
  por falta de credencial ensina a equipe a ignorar vermelho.

## Épico E5 — Sincronização (Fase 6) — **P0 concluído**
| ID | História | Pri | Cx | Depende | CA |
|---|---|---|---|---|---|
| E5-01 ✅ | Watermarks + scheduler + locks por (tenant,domínio) | P0 | M | E4 | sem execução dupla |
| E5-02 ✅ | Sync dimensões (todas as leves) | P0 | M | E5-01 | upsert idempotente |
| E5-03 ◐ | Sync produtos incremental (3 datas) + satélites (precos/ofertas/gtins) | P0 | G | E5-02 | watermark por tipo |
| E5-04 ✅ | Sync vendas hoje + finalizadoras hoje (5 min) | P0 | M | E5-02 | lag ≤10 min |
| E5-05 ✅ | Sync dia fechado + consolidação transacional (substitui realtime) | P0 | G | E5-04 | contagens batem; sem duplicar |
| E5-06 ✅ | Sync resumo diário /filiais/vendas + flags | P0 | M | E5-01 | 30d respeitado |
| E5-07 ✅ | Backfill resumível com progresso + janelas noturnas | P0 | G | E5-02..06 | 90 d sem gaps |
| E5-08 ✅ | Agregados (agg_*) recalculados por evento | P0 | M | E5-05 | consistentes com fatos |
| E5-09 ✅ | Sync financeiro (contas, despesas, cartões) | P1 | G | E5-01 | reconciliação semanal |
| E5-10 ◐ | Sync compras (pedidos, entradas) + perdas/trocas/vencimentos/movimentações | P1 | G | E5-01 | janelas ≤30 d |
| E5-11 | Sync previsão de vendas (+recortes) | P1 | M | E5-01 | mês corrente+próximo |
| E5-12 ✅ | Painel sync-status por tenant | P0 | M | E5-01 | lag/erros visíveis |

**E5-03 ficou parcial**: produtos (as três datas de alteração) e GTINs entraram; `/produtos/precos`
e `/produtos/ofertas` ficam para a Fase 7, junto com as telas que os consomem — schema e job sem
consumidor envelhecem sem ninguém notar (doc 24 §7).

O que a Fase 6 deixou pronto:

- **Motor de sincronização completo**: marcas d'água por (tenant, domínio, filial), lock
  distribuído por escopo, histórico de execuções, filas BullMQ com backoff de 1/5/15/60 min e
  processo de worker separado (mesma imagem, outro comando).
- **Seis domínios rodando**: conexão (health), cadastros, produtos + GTINs, vendas do dia
  corrente, consolidação do dia fechado e resumo diário por filial.
- **Backfill resumível** de até 26 meses, do dia mais recente para trás, com progresso na tela e
  retomada automática depois de queda ou deploy.
- **Agregados** de venda por hora e por departamento, recalculados na mesma transação do fato.
- **Painel de sincronização** com frescor por filial, últimas execuções e ações de
  ressincronizar/carregar histórico.

Decisões e descobertas da implementação:

- Duas comparações de data estavam invertidas (fatiamento de janela e laço do backfill) e os
  testes pegaram as duas: a primeira pediria à API períodos futuros, a segunda faria o backfill
  parar no primeiro dia. Aritmética de data é o lugar onde teste unitário paga sozinho.
- Um recurso ausente no ERP chegava como 404 e derrubava o job inteiro de cadastros. Passou a ser
  tratado como "esta instalação não tem" (doc 12 §8), igual a rota fora do contrato — o caso real
  é um tenant recém-configurado, antes do primeiro token, quando a claim `routes` ainda está
  vazia e não protege.
- O BullMQ recusa `:` em id de job; os ids determinísticos (que evitam fila duplicada) passaram a
  usar `--`.
- A confirmação do pedido de backfill sumia da tela: o bloco trocava para a barra de progresso e
  levava a mensagem junto. As mensagens saíram do trecho condicional (bug achado pelo E2E).
- O worker não tinha como ser raspado pelo Prometheus — e é nele que as métricas de sync nascem.
  Ganhou `/metrics` e `/healthz` numa porta própria (`WORKER_PORT`).
- Cada execução registra também o que **não** fez: `skipped` por lock ocupado, por tenant
  suspenso ou por dia ainda não fechado. Silêncio é a pior resposta para "por que isso não
  rodou?".

## Épico E6 — Plataforma transversal
| ID | História | Pri | Cx | CA |
|---|---|---|---|---|
| E6-01 ◐ | Auditoria append-only + hash chain + UI consulta (gravação e verificação prontas na Fase 3; falta a tela) | P0 | M | tamper test |
| E6-02 | Métricas Prometheus + painéis Grafana + alertas doc 18 | P0 | M | SLO board |
| E6-03 | Backups WAL-G + restore test semanal automatizado | P0 | M | doc 20 §3 |
| E6-04 | Jobs de retenção/purga (partições, logs, offboarding) | P0 | M | verify-purge zero |
| E6-05 | dashsgs-cli (tenant, sync, queue, crypto, breakglass) | P1 | M | runbooks executáveis |
| E6-06 | Export CSV assíncrono com máscara por papel | P1 | M | limite/permite testados |

## Épico E7 — Dashboard MVP (Fase 7) — **núcleo entregue**
| ID | História | Pri | Cx | Depende | CA |
|---|---|---|---|---|---|
| E7-01 ✅ | Home executiva (cards + curva do dia + ranking + fechamento) | P0 | G | E5-04..08 | snapshot KPIs |
| E7-02 ✅ | Vendas diário (cupons) + comparativos | P0 | G | E5-05 | p95<300ms |
| E7-03 ⛔ | Metas (previsão×realizado + projeção) | P0 | M | E5-11 | cálculo diasUteis |
| E7-04 ◐ | Estoque: ruptura + vencimentos + cobertura | P0 | M | E5-03/10 | curva A priorizada |
| E7-05 ✅ | Estados vazios/erro/parcial + selo de frescor | P0 | M | — | doc 16 §3 |
| E7-06 ◐ | Mobile da home + acessibilidade AA | P1 | M | E7-01 | Lighthouse/axe |
| E7-07 | Margem por nível (dep→produto) | P1 | G | E5-05 | custo configurável |
| E7-08 ✅ | Financeiro (aging, despesas, cartões) + Compras | P1 | G | E5-09/10 | amostras batem |
| E7-09 | Vendas por vendedor / ofertas | P2 | M | E5-05 | — |

**E7-03 está bloqueado por dado, não por tela**: metas dependem de `/previsaovendas`, que só é
sincronizado na E5-11. Entregar a tela sem a previsão seria mostrar uma meta inventada.
**E7-04 saiu parcial** pelo mesmo motivo: ruptura, estoque negativo, excesso e cobertura vêm do
cadastro de produtos (já sincronizado); vencimentos e perdas dependem da E5-10.
**E7-06 ficou parcial**: as telas são responsivas e acessíveis por construção (semântica, foco,
tabela alternativa nos gráficos, nada só por cor), mas a auditoria formal com Lighthouse/axe no
CI ainda não existe.

O que a Fase 7 deixou pronto:

- **Visão executiva**: venda, cupons e ticket do dia; curva por hora contra a média das quatro
  semanas anteriores; ranking de filiais; último dia fechado com margem, clientes e comparação
  com o mesmo dia da semana anterior; status de fechamento por filial.
- **Vendas**: diário cupom a cupom com filtros de dia, filial, caixa e cancelamento, totais,
  meios de pagamento e export CSV; comparativos com série diária, ranking de filiais,
  departamentos e corte por dia da semana.
- **Estoque**: ruptura priorizada por curva ABC e cobertura, estoque negativo e excesso.
- **Transversais**: selo de frescor em toda tela (parcial × consolidado), estados vazios que
  explicam o que falta, filtros que viram link compartilhável e cache por tenant com TTL do
  doc 14 §6.

Decisões e descobertas da implementação:

- **Gráficos em SVG no servidor** em vez de ECharts (ADR-014): o bundle inicial ficou em ~102 kB
  gz, contra o teto de 250 kB do doc 16 §5 — e cada gráfico ganhou tabela equivalente de graça.
- **Um endpoint por tela**, não por corte de dado: menos idas ao servidor e uma chave de cache
  por pergunta, em vez de cinco respostas para reconciliar no cliente.
- **Cache com single-flight**: no primeiro acesso da manhã, quando o TTL expira e a rede inteira
  abre o painel, uma consulta atende todo mundo em vez de N consultas idênticas.
- Um teste de cache derrubava dois testes seguintes porque apagava os cupons do tenant para
  provar que a resposta vinha do cache. Passou a **inserir** uma linha e conferir que ela não
  aparece — mesma prova, sem destruir o estado de quem vem depois.
- O seed passou a gravar **30 dias de vendas sintéticas**: sem isso, um ambiente novo abre o
  dashboard vazio e ninguém consegue revisar a tela sem antes montar uma integração.
- A suíte de isolamento precisou aceitar **422** nas listagens: o diário de vendas exige data, e
  requisição recusada na validação não chega a consultar nada.

## Épico E8 — Alertas (Fase 8) — **concluído**
| ID | História | Pri | Cx | CA |
|---|---|---|---|---|
| E8-01 ✅ | Motor de regras + dedupe + eventos | P0 | G | E2E ≤5 min |
| E8-02 ✅ | Canais e-mail + feed com ack | P0 | M | template acessível |
| E8-03 ◐ | Regras padrão doc 15 §8 (seed por tenant) | P0 | M | disparos testados |
| E5-09 ✅ | Sync financeiro — habilita 2 regras do §8 | P1 | G | reconciliação |
| E7-08 ✅ | Telas Financeiro e Compras | P1 | G | amostras batem |
| E8-04 ✅ | UI de configuração de regras | P1 | M | validação params |
| E8-05 ✅ | Alerta de integração (credencial/lag) p/ admin do tenant | P0 | P | — |

**E8-03 continua parcial por dependência de dado**: **sete** das dez regras do doc 15 §8 avaliam
hoje — ruptura curva A, estoque negativo, divergência de fechamento, queda de venda, integração
parada e, com a chegada de E5-09, conta a vencer e cartão não conciliado. As três restantes
(vencimento próximo, perda anormal e meta em risco) aparecem na tela desligadas com a dependência
escrita, e ligam sozinhas quando o resto de E5-10 e a E5-11 entrarem.

### Fechamento da Fase 8 — financeiro e compras

- **Sync financeiro (E5-09)**: contas a pagar e a receber com parcelas, despesas com seus tipos, e
  transações de cartão. Janela de −45 a +90 dias, cadência de 1 h.
- **Sync de compras (E5-10 parcial)**: pedidos e notas de entrada, janela de 60 dias.
- **Telas (E7-08)**: Financeiro com aging dos dois lados, fluxo previsto de 13 semanas, despesas
  por tipo (fixas × variáveis) e cartões com taxa efetiva e não conciliados; Compras com pedidos
  por situação, lead time médio e p90, pedidos parados e entradas do período.
- **Duas regras de alerta novas** ligadas pelo dado que chegou: conta a vencer e cartão não
  conciliado.

Decisões e descobertas:

- **Aging por parcela, não por título** — é onde mora o vencimento. E **taxa de cartão ponderada
  pelo volume**: a média simples faria uma transação de R$ 5 pesar como uma de R$ 5.000, e o teste
  de integração fixa esse comportamento com um caso em que as duas contas divergem (2% × 6%).
- O driver do Prisma manda número como `int8`, e o Postgres não tem operador `date - bigint`: a
  consulta de pedidos parados precisou de cast explícito. Apareceu como 500 no teste, não no
  cliente.
- Crase dentro de template literal abre interpolação — um comentário SQL com `date - bigint`
  quebrou a compilação inteira. Comentário em SQL embutido não leva crase.
- **Os nomes de campo dos endpoints financeiros ainda não estão confirmados pela SG.** Os schemas
  vieram do doc 03/05 e o teste de contrato noturno passou a cobrir os cinco recursos: se um campo
  tiver outro nome, o item cai na quarentena e o job noturno acusa — em vez de a tela de aging
  aparecer vazia para o primeiro cliente.

O que a Fase 8 deixou pronto (parte de alertas):

- **Motor** que avalia as regras ligadas a cada 5 minutos, deduplica por chave diária e só
  notifica o que é novo — rodando **fora** do caminho do sync, porque o alerta mais importante é
  justamente "a integração parou".
- **Feed** ordenado por severidade, com contagens, filtros, link para o contexto do problema e
  reconhecimento auditado.
- **E-mail** por audiência (operação × administração), com registro de entrega por destinatário
  em `app_notifications` — dá para responder "o cliente foi avisado?" sem depender do log do SMTP.
- **Tela de avisos** com limiares ajustáveis, liga/desliga por regra e a lista do que aguarda dado.
- **Métricas** `alert_events_total`, `alert_notifications_total` e `alert_delivery_seconds`.

Decisões e descobertas da implementação:

- A avaliação levava **15 s** para 9 eventos porque cada e-mail abria uma conexão SMTP própria e
  esperava a anterior. Com transporte em pool e envio paralelo por evento, caiu para **2,6 s**.
  No caminho apareceu um defeito latente: `tls` estava no segundo argumento de
  `createTransport`, que é o objeto de **padrões da mensagem** — não configurava o transporte.
  Agora a URL do SMTP é desmontada em opções explícitas, com `requireTLS` em produção.
- Testes que ajustavam limiar contaminavam os cenários seguintes; as regras passaram a ser
  recriadas a cada cenário, sempre a partir dos padrões do doc 15 §8.
- A home mostrava zero alertas com o feed cheio: o componente lia `contagens.total`, e a API
  devolve `contagens.abertos`. O contrato agora está tipado com os nomes reais.
- A suíte de isolamento ganhou um alerta do tenant vizinho como alvo: reconhecer alerta alheio
  responde 404, e desligar regra alheia também.

## Épico E9 — Hardening/GA (Fases 9–12)
E9-01 Pentest + correções (P0/G) · E9-02 CSP final sem unsafe-inline (P0/M) · E9-03 Break-glass
auditado (P1/M) · E9-04 DPA/política/DPO (P0/M, jurídico) · E9-05 Billing/planos (P0/G) ·
E9-06 Status page (P1/P) · E9-07 Game-day DR (P0/M).

## Épico E10 — Ações no ERP (Fase 13, P2 no MVP)
E10-01 Framework de propostas/aprovação (G) · E10-02 Oferta (M) · E10-03 Pedido de compra (G) ·
E10-04 Acertos de estoque (M) · E10-05 Baixa/correção cartões (G) · E10-06 GTINs (P) ·
E10-07 Verificação pré/pós execução (sem idempotência na API) (M).

## Épico E11 — Futuro (P3)
Módulo Clientes opt-in completo · Webhooks de saída · Multi-conexão por tenant ·
Benchmark anônimo entre tenants (parecer jurídico) · App notificações push · ClickHouse p/
histórico longo · K8s.
