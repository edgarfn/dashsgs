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
| Q2 | Formato canônico do header `Authorization`: JWT puro ou `Bearer <jwt>`? Ambos aceitos? — **confirmado: JWT puro (ver §4.6)** | Implementação do token manager | F5 |
| Q3 | Existe **rate limit**/limite de conexões? Qual RPS é seguro sem afetar o ERP da loja? | Calibrar self-throttling (R4) | F5 prod |
| Q4 | `itensPorPagina` máximo aceito por endpoint? | Custo de backfill | F6 |
| Q5 | No **SG Cloud**, o prefixo `/public` vale só para `/autorizacao` ou para todas as rotas? — **confirmado: só a autorização (ver §4.6)** | Cliente HTTP correto p/ tenants cloud | F5 (tenants cloud) |
| Q6 | POSTs são idempotentes de alguma forma? `idPedidoIntegrador` duplicado é rejeitado ou duplica pedido? | Estratégia de reprocesso seguro (R5) | F13 |
| Q7 | Existe changelog/aviso de mudanças da API? Versionamento além de `/v1`? | Gestão de drift (R6) | — |
| Q8 | Há endpoints/eventos push não publicados (webhooks)? | Simplificaria tempo real | — |
| Q9 | `GET /sgsistemas/v1/status` exige token? — **confirmado: não exige (ver §4.6)** | Health-check sem consumir login | — |
| Q10 | Token: existe revogação server-side ao trocar a senha do usuário de integração? | Janela de exposição em incidente | — |
| Q11 | Podem emitir **usuário somente-leitura** (subconjunto de rotas GET) por padrão? | Least privilege contratual | F5 |
| Q12 | Timezone dos campos `horario`/`expire_time`: sempre o fuso do servidor da loja? | Correção de séries por hora | F6 |
| Q13 | `/vendas/hoje` após o fechamento: retorna vazio, erro ou dados parciais? | Semântica do realtime | F6 |
| Q14 | Período máx. de 30 dias vale também para /produtos/vendas, /perdas, /contas/*? (documentado só p/ movimentações, trocas e /filiais/vendas) | Janelas de sync | F6 |
| Q15 | Encoding garantido UTF-8? Campos texto podem vir em CP850/Latin1 de bases antigas (ERP Harbour)? | Normalização de acentuação | F6 |
| Q16 | Homologação: dados são resetados? Podemos usá-la p/ testes nightly contínuos? | Contrato nightly (doc 12 §7) | — |
| Q17 | `/vendas`, `/vendas/hoje`, `/vendas/finalizadoras(/hoje)` e `/filiais/vendas` devolvem 403 nesta homologação mesmo com as 5 rotas presentes na claim `routes` do token — é módulo de PDV/vendas não provisionado nesta conta, ou outra coisa? (medido 19/09/2026, ver doc 34 §4.8) | Sem isso não dá para saber se 403-com-claim-positiva é "nunca vai responder" ou "tentar depois" | F6 |

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

### 4.6 Três respostas confirmadas contra a fonte real (18/09/2026)

A página `https://api-doc.sgsistemas.com.br/` é uma SPA (Postman-published-docs) — o conteúdo
inteiro vem de um endpoint JSON que a alimenta. Baixar essa coleção direto (114 endpoints, ~1,2 MB)
deu evidência concreta para duas das cinco questões que a §4 tratou como configuração por falta de
resposta, mais uma terceira que nem estava na lista de bloqueio:

- **Q2 (formato do header) confirmado: JWT puro.** Nos 113 dos 114 endpoints da coleção que
  declaram o header, o valor é o token cru — sem prefixo `Bearer`. Um único endpoint (`GET`
  Acerto de Estoque de Entrada) carrega um bloco `auth.type: "bearer"` do próprio Postman, mas
  isso não se repete em nenhum outro item, nem no nível da pasta, nem no da coleção — lido como
  resíduo de manutenção de quem mantém a coleção do lado da SG, não como o contrato documentado.
  O padrão `raw` que o produto já usa por default está certo.
- **Q5 (prefixo `/public`) confirmado: só a autorização.** Em toda a coleção, a única menção a
  `/public` ou "SG Cloud" está na própria descrição do endpoint de autorização: *"Para utilizar
  integração no ambiente SG Cloud, usar: `http://base_url/public/integracao/sgsistemas/v1/autorizacao`"*.
  Nenhuma outra descrição de endpoint cita o prefixo. É evidência por ausência — não uma garantia
  contratual —, mas é o que o produto já assumia como padrão (`apiPathPrefix` vazio).
- **Q9 (o `/status` exige token?) confirmado: não exige.** Testado direto contra a homologação:
  `GET http://sgps.sgsistemas.com.br:8201/sgsistemas/v1/status` respondeu 200 sem nenhum header
  de autorização, devolvendo versão do ERP, revisão e o CNPJ da filial base.

Q1, Q3 e Q4 continuam sem menção na documentação pública — nada mudou para elas aqui.

**Teste de ponta a ponta contra a homologação real.** Com uma credencial de homologação fornecida
pelo dono do produto (usuário `homologacao`), a conexão foi cadastrada e testada através da
própria aplicação — `PUT /tenant/erp-connection` seguido de `POST /tenant/erp-connection/test`,
com `SG_MOCK=false` só naquele processo — nunca por uma chamada solta fora do caminho auditado e
cifrado do produto. Resultado: `status: "ok"`, saúde reportando a mesma versão do teste acima, e
**112 rotas liberadas** — bem mais que as ~28 do conjunto de fixtures do mock, incluindo rotas de
escrita (`acertoestoque`, `clientes`, `ofertas`, `pedidoscompra`, `pedidosvenda`). Nenhuma escrita
foi executada; o produto só escreve com `FEATURE_ERP_WRITE=true` (desligada por padrão), e é essa
flag — não o escopo do token — que segura essa porta.

Um detalhe que valeu a pena conferir: o servidor real devolve a claim `routes` em **maiúsculas**
(`"GET /SGSISTEMAS/V1/STATUS"`), diferente do mock, que usa minúsculas. `assertRotaContratada`
(`apps/api/src/integration/sg/sg.client.ts`) já normaliza os dois lados com `.toUpperCase()` antes
de comparar — não foi preciso mudar nada, mas é exatamente o tipo de variação que quebraria em
silêncio se essa normalização um dia fosse "simplificada" embora pareça redundante.

Não foi disparado nenhum sync de domínio (produtos, vendas, financeiro) contra o servidor real
nesta rodada — o teste ficou deliberadamente restrito a autorização e health-check.

> **Correção (§4.7, mesma data):** a contagem de "112 rotas liberadas" acima **não se sustentou na
> medição seguinte** e deve ser lida como errada. Medindo a claim direto no `SgTokenManager`, com
> token novo e com token de cache, ela vem **vazia (0 rotas)** nas duas situações; o health-check
> das 15:26 gravou `routes_granted` vazio, e é esse o estado da coluna. A lista de rotas de
> escrita citada acima veio da coleção Postman pública, não da claim — o risco que ela descreve
> continua valendo, mas a frase "112 rotas liberadas" atribuía à claim algo que não estava lá.

### 4.7 Primeiro sync real contra a homologação (18/09/2026)

A §4.6 parou de propósito em autorização e health-check. Esta rodada foi adiante: o domínio
`dimensoes` (11 rotas, só leitura) rodou de verdade contra `http://sgps.sgsistemas.com.br:8201`,
com `SG_MOCK=false` apenas no processo. Resultado final: **4.546 registros reais gravados, 0
inválidos, 11 chamadas**. Antes disso, três defeitos precisaram ser corrigidos — todos invisíveis
para o mock, e é esse o ponto da seção.

#### O que a API respondeu

| Rota | Resposta real |
|---|---|
| `GET /filiais` | 1 filial: `erp_id 1`, "SGS DEMONSTRACAO", CNPJ `31875378987` |
| `GET /departamentos/nivel1..6` | 361 / 58 / 11 / 3 / 1 / 1 |
| `GET /marcas` | 1.733 |
| `GET /agrupamentos` | 2.358 |
| `GET /classes` | 3 |
| `GET /unidadesmedida` | 17 itens, **16 chaves** — `U` vem duas vezes |
| `GET /vendas/hoje` | 200, 0 itens |
| `GET /vendas/finalizadoras` | 200, 0 itens |
| `GET /finalizadoras/hoje` | **404** |
| `GET /vendas` (dia fechado) | **5xx** |
| `GET /filiais/vendas` | **400**, por motivo que não é o tamanho de página |

`invalidos = 0` em todas as coleções: os schemas Zod batem com o payload real sem ajuste. É a
melhor notícia da rodada — os mappers foram escritos contra a documentação e sobreviveram ao
contato com o servidor.

#### Defeito 1 — chave repetida derrubava o domínio inteiro

`upsertLote` monta um `INSERT ... ON CONFLICT DO UPDATE` com o lote todo, e o Postgres recusa a
instrução inteira quando duas linhas propostas disputam a mesma chave (`21000: ON CONFLICT DO
UPDATE command cannot affect row a second time`). A SG manda a unidade de medida `U` duas vezes —
ela tem `U` e `UN`, ambas "UNIDADE" —, então **uma única duplicata no cadastro do cliente
derrubava os 4.546 registros**, com quatro retentativas e DLQ no fim. As fixtures do mock têm id
único; nenhum dos 298 testes unitários podia acusar isso.

Correção: `colapsarPorChave` colapsa antes de montar o SQL, mantendo a **última** — que é o que o
`ON CONFLICT DO UPDATE` faria se o Postgres aceitasse. Chave com `NULL` não colapsa, porque no
Postgres dois `NULL` não conflitam entre si e juntá-los apagaria linha que o banco aceitaria. A
duplicata não some calada: vai para o log e para a `observacao` do painel.

#### Defeito 2 — a degradação de página era uma catraca só para baixo

A Q4 (teto de `itensPorPagina` por rota) foi resolvida com degradação automática: 400 na rota
paginada → corta o tamanho pela metade → grava o valor na conexão. Contra o servidor real ficou
claro que **gravar era cedo demais**. `GET /filiais/vendas` responde 400 por um motivo que não é o
tamanho, e o cliente foi cortando 200 → 100 → 50 **gravando cada palpite**. Como nada nunca
aumenta o valor de volta, um 400 sobre outro parâmetro baixava permanentemente a página daquela
rota, para aquele tenant, sem nunca conseguir sucesso.

Correção: reduzir continua sendo a sondagem, mas o valor só vira fato aprendido **depois que uma
resposta chega inteira naquele tamanho**. Verificado contra o servidor real: a sequência
200 → 100 → 50 ainda acontece, e `page_size_por_rota` termina nula.

#### Defeito 3 — o portão de contrato está inerte, e parece ativo

`assertRotaContratada` libera tudo quando `routesGranted` está vazio, com o comentário "conexão
ainda sem token (primeiro uso)". Mas nesta instalação o token **é obtido com sucesso e a claim
`routes` vem vazia** — medido com token novo e com token de cache. O resultado é que a proteção
do doc 12 §5 nunca atua aqui, e nada diz isso: o painel mostra "conexão ok" e o health registra
"0 rotas", que um operador lê como contagem, não como "o portão está desligado".

Não corrigido nesta rodada, porque a correção é uma decisão de produto e não um reparo: "claim
vazia" precisa deixar de ser indistinguível de "ainda não sei", e isso muda o que a tela promete.

> **Correção (mesma data, ~1h depois):** "vem vazia" não é o fato — é **inconsistente**. Um
> refresh de token durante o reseed de `dimensoes` que se segue (§4.7 acima) logou
> `sg_token_refreshed` com `rotas: 114`, mesmo caminho de código que antes tinha medido zero duas
> vezes seguidas (token novo e de cache). Não investiguei a causa — pode ser estado do lado da SG,
> pode ser algo em como o teste anterior forçou a invalidação. O que fica de pé é o problema de
> design (lista vazia = "libera tudo" é ambíguo entre "sem token" e "contrato vazio"); o que **não**
> fica de pé é a alegação de que a claim é sempre vazia nesta instalação.
Mesmo formato do furo de TLS/VPN da §4.4 — mecanismo de proteção que não se aplica, sem aviso.

#### Resíduos conhecidos

- **Espelho misto.** O sync é upsert: a filial 1 passou a ser a real, e as filiais 2, 3 e 4 do
  seed sintético continuam na tabela. O painel soma uma loja real com três fictícias. Um
  `pnpm db:seed` limpa, ou o offboarding do tenant demo.
- **`vendas_hoje` não funciona nesta instalação** — não por causa da filial, mas porque
  `GET /finalizadoras/hoje` responde 404. `GET /vendas/hoje` sozinha funciona.
- **Execução interrompida não é reconciliada.** Um worker morto no meio deixa `sync_job_runs` e
  `sync_watermarks` em `running` para sempre (6 e 5 linhas, nesta rodada). O `atrasado` do painel
  se calcula por `last_success_at`, então o alerta de atraso ainda funciona — mas o status, não.
- **`sync_api_call_log` nunca é escrita.** `registrarChamadas()` não tem um único chamador no
  produto; só o teste de integração a invoca direto, e passa verde. A contabilidade de custo por
  tenant do doc 05 §2 não existe, e a retenção purga diariamente uma tabela sempre vazia. O dado
  por chamada já é medido em `sg-http.client.ts` para o Prometheus — falta uma porta
  `contabilizar` no contexto, no mesmo idioma de `credenciais` e `aprender`.

### 4.8 Por que 3 de 5 rotas de venda falhavam (19/09/2026)

A §4.7 registrou cinco falhas em rotas de venda sem investigar a causa de cada uma — ficou como
próximo passo. Esta rodada foi atrás de cada uma, usando a coleção Postman pública da SG (a
mesma da §4.6) como fonte de contrato, e mediu contra o servidor real em vez de supor.

#### Um bug de verdade, achado e corrigido

`getFinalizadoras` montava `/finalizadoras/hoje` para a variante "hoje" — a coleção da SG mostra
`/vendas/finalizadoras/hoje`; faltava o segmento `/vendas`. Era 404 garantido contra o servidor
real, sempre. O mock nunca acusou porque casava por `caminho.endsWith('/finalizadoras/hoje')`,
que aceita o caminho certo e o errado igualmente — comparado ao resto do arquivo (que evita essa
colisão por ordem, como `/previsaovendas/diaria` antes de `/previsaovendas`, ou por sufixo único),
esta era a única linha frouxa o bastante para esconder um segmento de caminho inteiro faltando.

Corrigido em dois lugares: o caminho em `sg.client.ts` (`/vendas/finalizadoras/hoje`) e o casador
do mock, apertado para o caminho completo — não porque o caminho certo dependa disso, mas para
que a MESMA classe de regressão não volte a passar despercebida se alguém reintroduzir o bug.

#### Um beco sem saída que valeu a pena percorrer até o fim

A hipótese inicial era que `assertRotaContratada` (o portão de contrato client-side, doc 12 §5)
estivesse rejeitando essas rotas por engano — a claim `routes` chegou a ser medida com 114
entradas, incluindo `GET /INTEGRACAO/SGSISTEMAS/V1/VENDAS/HOJE` e as outras quatro, literalmente.
Instrumentação elemento-a-elemento da comparação confirmou: `assertRotaContratada` casava
corretamente e **nunca** lançava para essas chamadas. O erro `rota_nao_contratada` que aparecia
tinha origem completamente diferente — a mesma etiqueta de falha é usada em dois lugares do
código (`sg.client.ts` para o portão client-side; `sg-errors.ts` para classificar uma resposta
HTTP 403 do servidor), e só o `detalhe` do erro (`status`, `mensagemOrigem`, `segundaTentativa`)
distingue as duas origens. Vale a lição: quando o mesmo nome de falha pode nascer de dois lugares
diferentes, depurar pelo nome sozinho engana — foi preciso instrumentar de verdade para achar.

#### A causa real: 403 do servidor, direto na primeira tentativa

Capturado o `detalhe` do erro: `{"status":403,"mensagemOrigem":null,"segundaTentativa":false}`.
403 na primeira tentativa, sem retry (a lógica de renovar token e trocar formato de header só
dispara em 401 — `classificarResposta` manda 403 direto para `rota_nao_contratada`, sem chance de
ser confusão de header), corpo de resposta sem mensagem. Isto é o servidor recusando de propósito,
não um formato de chamada errado nosso: as mesmas 5 rotas, incluindo a já corrigida
`/vendas/finalizadoras/hoje`, devolveram 403 de forma consistente em duas rodadas seguidas,
minutos depois de o token ter sido obtido com as 5 rotas explicitamente listadas na claim.

A claim do token e o que o servidor de fato deixa passar **não concordam** para esta família de
rotas nesta instalação de homologação — o token diz "pode", o servidor recusa. Isso não é
contraditório com o resto: a claim `routes` já era conhecida por variar entre chamadas (§4.7,
Defeito 3), e agora fica mais um sintoma da mesma instabilidade — o RECORTE de conteúdo muda, e
aparentemente o que é de fato ENFORÇADO no servidor não é garantido bater com o que a claim lista.

Dado colateral: um teste anterior, horas antes desta rodada (registrado na §4.7), tinha medido
`GET /vendas/hoje` e `GET /vendas/finalizadoras` como **200 com 0 itens** — não 403. Mesma conta,
mesmas rotas, resultado diferente em momentos diferentes. Não há, do nosso lado, nenhuma mudança
de código ou de configuração entre as duas medições que explique a diferença.

#### O que isso significa

Nada a corrigir no cliente além do bug do caminho. As outras quatro rotas (`/vendas`,
`/vendas/hoje`, `/vendas/finalizadoras`, `/filiais/vendas`) — mais a quinta depois da correção do
caminho — dependem de uma resposta do lado da SG: por que a claim lista rotas que o servidor
recusa com 403, e se isso é um estado permanente desta conta de homologação (módulo de
vendas/PDV não provisionado) ou mais uma variação temporária como as já catalogadas. Sem essa
resposta, o produto não tem como saber se deve tratar 403-com-claim-positiva como "quarentena
definitiva" ou "tentar de novo mais tarde" — e arriscar o segundo sem saber é gerar alerta falso
de integração quebrada para um cliente real cujo módulo simplesmente não inclui vendas via API.
