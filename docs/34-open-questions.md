# 34 — Perguntas que Precisam de Confirmação

Destinatário principal: SG Sistemas (contato@sgsistemas.com.br) e/ou tenant piloto.
Nenhuma resposta bloqueia as fases 2–4 do roadmap; Q1–Q4 bloqueiam a fase 5 em produção.

> **Q1–Q5 deixaram de bloquear (18/09/2026).** Cada uma virou configuração ajustável por tenant,
> com padrão da instalação por variável de ambiente — ver §4. A resposta da SG, quando vier, é um
> ajuste na tela de Conexão ERP; não é deploy. O que **não** virou configuração, e por quê, está
> em §4.3.

## Para a SG Sistemas (técnico)

| # | Pergunta | Por que importa | Bloqueia |
|---|---|---|---|
| Q1 | A API do cliente pode ser exposta via **HTTPS** (certificado próprio/SG Cloud)? Qual a prática recomendada de transporte em produção? | R1 (crítico): sem TLS não colocamos credencial/PII na rede | F5 prod |
| Q2 | Formato canônico do header `Authorization`: JWT puro ou `Bearer <jwt>`? Ambos aceitos? | Implementação do token manager | F5 |
| Q3 | Existe **rate limit**/limite de conexões? Qual RPS é seguro sem afetar o ERP da loja? | Calibrar self-throttling (R4) | F5 prod |
| Q4 | `itensPorPagina` máximo aceito por endpoint? | Custo de backfill | F6 |
| Q5 | No **SG Cloud**, o prefixo `/public` vale só para `/autorizacao` ou para todas as rotas? | Cliente HTTP correto p/ tenants cloud | F5 (tenants cloud) |
| Q6 | POSTs são idempotentes de alguma forma? `idPedidoIntegrador` duplicado é rejeitado ou duplica pedido? | Estratégia de reprocesso seguro (R5) | F13 |
| Q7 | Existe changelog/aviso de mudanças da API? Versionamento além de `/v1`? | Gestão de drift (R6) | — |
| Q8 | Há endpoints/eventos push não publicados (webhooks)? | Simplificaria tempo real | — |
| Q9 | `GET /sgsistemas/v1/status` exige token? | Health-check sem consumir login | — |
| Q10 | Token: existe revogação server-side ao trocar a senha do usuário de integração? | Janela de exposição em incidente | — |
| Q11 | Podem emitir **usuário somente-leitura** (subconjunto de rotas GET) por padrão? | Least privilege contratual | F5 |
| Q12 | Timezone dos campos `horario`/`expire_time`: sempre o fuso do servidor da loja? | Correção de séries por hora | F6 |
| Q13 | `/vendas/hoje` após o fechamento: retorna vazio, erro ou dados parciais? | Semântica do realtime | F6 |
| Q14 | Período máx. de 30 dias vale também para /produtos/vendas, /perdas, /contas/*? (documentado só p/ movimentações, trocas e /filiais/vendas) | Janelas de sync | F6 |
| Q15 | Encoding garantido UTF-8? Campos texto podem vir em CP850/Latin1 de bases antigas (ERP Harbour)? | Normalização de acentuação | F6 |
| Q16 | Homologação: dados são resetados? Podemos usá-la p/ testes nightly contínuos? | Contrato nightly (doc 12 §7) | — |

## Para o tenant piloto (negócio/infra)

| # | Pergunta | Por que importa |
|---|---|---|
| T1 | O ERP é on-premise ou SG Cloud? Há IP fixo/possibilidade de VPN? | Modo de transporte |
| T2 | Quantas filiais, produtos ativos e cupons/dia? | Dimensionar backfill/cadências |
| T3 | Horário de fechamento diário habitual e responsável? | Orquestração da consolidação |
| T4 | Quais rotas o contrato SG de vocês libera hoje? (rodar /autorizacao e ler `routes`) | Escopo real de features |
| T5 | Profundidade de histórico desejada (12/26 meses)? | Custo de backfill |
| T6 | Precisam de dados de clientes identificados (CRM/crediário)? Existe base legal mapeada? | Gate do módulo Clientes (DPIA) |
| T7 | Janela noturna aceitável p/ sync pesado? | Configuração inicial |

## Decisões internas pendentes (não dependem da SG)

| # | Decisão | Prazo |
|---|---|---|
| D1 | Provedor de hospedagem/região (Brasil) e Postgres gerenciado | antes F9 |
| D2 | Nome/domínio definitivo do produto | antes F12 |
| D3 | Designar DPO e jurídico p/ DPA/política | antes F11 |
| D4 | Política comercial de planos (filiais? usuários? módulos?) | antes F12 |

## 4. Q1–Q5 como configuração (18/09/2026)

O dono do produto perguntou se dava para seguir sem as respostas, tratando cada uma como
configuração. Dava — e a auditoria do código mostrou que o custo de **não** fazer isso era maior
do que parecia: três das cinco respostas estavam cravadas como suposição, e uma delas escondia um
furo de segurança.

### 4.1 O que cada uma virou

| # | Onde se ajusta | Padrão de fábrica | O que acontece se a SG responder diferente |
|---|---|---|---|
| Q1 transporte | `tls_mode` por tenant (tela) + `SG_VPN_CIDR` (aceita várias faixas) | `https` | Túnel novo é mais um CIDR na env; HTTP em claro continua recusado |
| Q2 header | `auth_header_mode` por tenant (tela) + `SG_AUTH_HEADER_MODE` | `raw`, **e o cliente descobre sozinho** | Nada: a primeira recusa ensina e o valor fica gravado |
| Q3 rate limit | `max_rps` por tenant (tela) + `SG_DEFAULT_MAX_RPS` | 4 rps | 429 agora é falha própria, retentável, que respeita `Retry-After` |
| Q4 página | `page_size` por tenant + `page_size_por_rota` + `SG_PAGE_SIZE`/`SG_PAGE_SIZE_MIN` | 500, piso 50 | Endpoint que recusar o tamanho é reduzido sozinho e o teto fica gravado |
| Q5 prefixo `/public` | `api_path_prefix` por tenant (tela) + `SG_API_PATH_PREFIX` | vazio (só a autorização) | `/public` no campo cobre "vale para todas as rotas" |

### 4.2 O que a auditoria encontrou no caminho

- **Q5 estava cravado.** O `/public` só existia colado à constante do caminho de autorização; as
  rotas de dados eram montadas de um `BASE` fixo. Se a resposta for "vale para a API inteira",
  todo tenant SG Cloud quebraria — e a correção seria deploy, não configuração.
- **Q2 se auto-resolvia, mas esquecia.** O cliente já tentava o formato alternativo no 401, só
  que gravava a descoberta **apenas no cache do token** (50 min). Todo refresh relia a coluna do
  banco, que nunca deixava de ser `raw`: uma instalação que exige `bearer` pagava um 401 de
  aprendizado a cada ciclo, para sempre. Agora a descoberta é persistida.
- **Q3 tratava "reduza o ritmo" como dado corrompido.** Não havia nenhum tratamento de 429 em
  lugar nenhum: a resposta caía no ramo final e virava `resposta_invalida`, que na taxonomia
  significa "não repetir, quarentenar". O produto jogaria a página fora e marcaria o dado do
  cliente como inválido porque o servidor pediu calma.
- **Q4 tinha número mágico.** `/filiais/vendas` usava `itensPorPagina: 200` escrito no meio de
  uma chamada, sem nome nem motivo. Virou tabela `TETO_POR_ROTA`, declarada como suposição.
- **Q1 escondia um furo de segurança — corrigido.** Ver §4.4.

### 4.3 O que **não** virou configuração, e por quê

- **Confiança TLS (CA própria, certificado auto-assinado, mTLS, versão mínima).** É o caso mais
  provável num ERP de loja, e hoje falha de forma opaca: o `fetch` recusa o certificado, o erro
  vira `inalcancavel` e o suporte vai caçar rede enquanto o problema é confiança. Não virou
  configuração porque exige trocar o transporte (`fetch` cru → agente com CA), e porque "aceitar
  certificado inválido" não pode ser uma caixinha no wizard: é a diferença entre TLS e teatro.
  Entra como item próprio de backlog, com desenho.
- **Afrouxar a proibição de HTTP em produção.** `ALLOW_INSECURE_ERP` continua global e continua
  derrubando o boot em produção. Tornar isso ajustável por tenant transformaria a regra que
  protege a credencial do cliente numa preferência — e a experiência desta auditoria é
  justamente que o caminho fácil vira o caminho usado.
- **Janelas de 30 dias por recurso (Q14) e timezone dos campos (Q12).** Ficam como estão nesta
  passada; são perguntas de sincronização, não de transporte, e não bloqueiam ninguém hoje.

### 4.4 Correção de segurança encontrada durante a auditoria (Q1)

O guarda anti-SSRF exigia TLS apenas quando `tls_mode = https`:

```ts
if (url.protocol === 'http:' && options.tlsMode === 'https' && !options.allowInsecure) { recusa }
```

E no laço de IPs, um endereço **público** era aceito por `continue` **antes** de chegar à
verificação da faixa do túnel. As duas regras combinadas aceitavam, em produção,
`http://host-publico` com o modo VPN selecionado: a senha do usuário de integração e os dados de
venda trafegariam em claro pela internet, enquanto a trilha de auditoria registrava
`tls_mode: 'vpn'` — que qualquer auditor lê como "tráfego cifrado". Nenhum teste cobria o caso.

A correção inverte a ordem e aperta a regra: **no modo VPN o destino precisa estar dentro do
túnel**, público ou privado, com ou sem TLS. O sigilo ali vem do túnel; endereço fora dele é
configuração errada, não uma variação aceitável. `apps/api/test/unit/url-guard.spec.ts` ganhou a
regressão.

### 4.5 Nota de fuso horário (achado colateral)

Vários testes de integração calculavam "hoje" em UTC enquanto o produto calcula no fuso do
tenant. Entre 00h e 03h UTC os dois divergem e a suíte falhava por três horas todo dia, com
mensagens que não tinham relação com o cenário. Os testes passaram a usar `hojeNoTenant()`.

**Resíduo corrigido em 18/09/2026.** A passada seguinte fechou os pontos do produto — e eram
mais do que os dois anotados aqui:

| Onde | O que decidia errado |
|---|---|
| Financeiro — aging | `CURRENT_DATE` classificava como **vencido** o título que ainda vence hoje para quem opera a loja |
| Financeiro — fluxo previsto | parcela do dia sumia do horizonte de 13 semanas |
| Financeiro — cartões não conciliados | a régua de 7 dias corria um dia adiantada |
| Compras — dias em aberto | "parado há 40 dias" virava 41 |
| Auditoria — filtro de período | evento das 22h caía no dia seguinte e sumia do filtro |

A correção tem duas metades. `inicioDoDiaEm`/`fimDoDiaEm` (em `common/datas.ts`) são o inverso de
`diaEm`: dado um dia local, devolvem o instante UTC em que ele começa e termina, com o offset
lido do `Intl` — o que acerta horário de verão sem carregar base de fusos. E as rotas do
dashboard passaram a mandar `hoje` já no fuso do tenant para os serviços, em vez de deixar o SQL
perguntar ao relógio do banco.

O `hoje` entrou também na **chave do cache**: sem isso, uma resposta gravada ontem continuaria
respondendo "vencido" para quem pergunta hoje.

Os testes de borda (`sync-datas.spec.ts`) fixam o comportamento com datas explícitas, inclusive na
virada do horário de verão de Nova York e num fuso a leste de Greenwich — casos em que um cálculo
com offset fixo erraria. A suíte completa foi executada dentro da janela de divergência (02:57
UTC, quando em São Paulo ainda era o dia anterior).
