# 12 — Especificação de Integração com a API SG

Camada `integration/sg` (anti-corruption layer). Objetivo: o resto do sistema nunca vê as
inconsistências da API SG — só tipos limpos e estáveis.

## 1. Configuração por tenant

```ts
ErpConnection {
  baseUrl: string          // validado: DNS público, sem IP privado/loopback/metadata
  isSgCloud: boolean       // true → authPath = '/public/integracao/sgsistemas/v1/autorizacao'
  tlsMode: 'https' | 'vpn' // http público recusado
  username: string
  secret: EncryptedRef     // nunca em memória além do uso
  maxRps: number = 4       // self-rate-limit [RECOMENDAÇÃO]
  syncWindow?: { start: '01:00', end: '06:00' } // janelas pesadas (backfill) por tenant

  // As quatro abaixo existem porque a SG ainda não respondeu (doc 34 §4). Nulo/vazio = herda o
  // padrão da instalação; a resposta, quando vier, é um UPDATE aqui — não um deploy.
  apiPathPrefix?: string   // Q5: prefixo de TODAS as rotas, ex.: '/public'
  authHeaderMode: 'raw' | 'bearer'  // Q2: descoberto sozinho no primeiro 401 e persistido
  pageSize?: number        // Q4: itens por página pedidos à API
  pageSizePorRota?: Record<string, number>  // Q4: teto que a API confirmou, por rota
}
```

[NECESSITA CONFIRMAÇÃO junto à SG] — **nenhuma delas bloqueia**, todas viraram configuração
(doc 34 §4): suporte a HTTPS no endpoint do cliente; prefixo `/public` nas demais rotas do SG
Cloud; limite de RPS tolerado; `itensPorPagina` máximo por endpoint.

## 2. Autenticação (token manager)

- `POST {base}/integracao/sgsistemas/v1/autorizacao` body `{usuario, senha}` [DOCUMENTADO].
- Sucesso 200: `{token, routes[], expire_time}`; falha 401 sem corpo [DOCUMENTADO].
- Cache Redis por tenant, TTL = 50 min; renovação com lock (single-flight); em 401 durante uso:
  invalidar + reautenticar 1x; segunda falha → circuit open + `erp_connection.status=error` +
  alerta ao admin do tenant.
- Guardar `routes[]` em `routes_granted` a cada renovação; **diff gera evento** (rota
  adicionada/removida do contrato) — alimenta degradação graciosa de features.
- Header: `Authorization: <jwt>`; fallback `Bearer <jwt>` se 401 [NECESSITA CONFIRMAÇÃO].

## 3. Cliente HTTP (política única)

| Aspecto | Política |
|---|---|
| Timeout | connect 5 s; response 60 s (endpoints com `emitePISCOFINS`/`emiteCustoSemEncargos`: 180 s) |
| Retries | GET: 3 tentativas, backoff exponencial 1s→4s→9s + jitter, apenas para timeout/5xx/rede; **POST/PATCH/DELETE: 0 retry automático** (sem idempotência garantida na API) — reprocesso manual via fila com verificação prévia |
| Rate limit | Token bucket por tenant (maxRps); fila de espera com prioridade (tempo-real > backfill) |
| Circuit breaker | 5 falhas/60 s → open 120 s → half-open 1 sonda |
| Paginação | Iterador assíncrono: `pagina++` até `pagina >= quantidadePaginas`; `itensPorPagina=200` padrão (500 p/ dimensões) [RECOMENDAÇÃO; máximo aceito NECESSITA CONFIRMAÇÃO]; tolerar envelope `paginacao` OU `ordenacao` OU array puro |
| Datas | Sempre `YYYY-MM-DD`; janelas ≤30 dias onde documentado (movimentações, trocas, /filiais/vendas) |
| Encoding | JSON UTF-8; `Content-Type: application/json` em escritas |

## 4. Normalização (mappers) — regras obrigatórias

1. `trim()` em todo id/código string (`idOferta "5 " → "5"`, séries, gôndolas).
2. Char-flags → enums tipados: ex. situação `" "→NORMAL, "C"→CANCELADA, "P"→PENDENTE...`
   (tabelas de domínio versionadas conforme doc 03).
3. `""` em campos de data → `null`.
4. Números: aceitar int/float; nunca usar float binário para dinheiro no nosso lado —
   converter para `numeric`/centavos na persistência.
5. Campos ausentes vs. presentes-vazios tratados igualmente (schema com defaults).
6. Allowlist de campos (privacidade — doc 10): mapper ignora o que não está no schema.
7. Validação zod da resposta; item inválido → quarentena + métrica `sg_invalid_items_total`,
   página continua (não abortar o sync por 1 registro ruim).
8. `tipoEntidade`: normalizar para enum `CLIENTE|FORNECEDOR|FILIAL` a partir de "C/F/E" ou texto.
9. `idSubstituido` em pedidos de venda: marcar registro antigo como substituído.

## 5. Catálogo de operações (interface tipada)

```ts
interface SgClient {
  // dimensões
  listFiliais(); listProdutos(f: ProdutoFilter); listGtins(); listDepartamentos(n:1..6);
  listMarcas(); listClasses(); listAgrupamentos(); listUnidades(); listMunicipios();
  listFornecedores(); listProdutoFornecedores(); listCompradores(); listVendedores();
  listFormasPagamento(); listPrazos(); listRotas(); listPdvs(filial); listSeries(); listMotivos(kind);
  // fatos
  getVendasDia(filial, data, opts); getVendasHoje(filial); getFinalizadoras(filial, data);
  getFinalizadorasHoje(filial); getResumoFilial(filial, ini, fim /*≤30d*/);
  getProdutoVendas(filial, ini, fim); getMovimentacoes(filial, ini, fim /*≤30d*/, tipo?);
  getPerdas(filial, ini, fim); getTrocas(filial, ini, fim /*≤30d*/); getVencimentos(filial, ...);
  getEntradas(filial, ini, fim | id); getEntradaProdutos(...); getEntradaChave(id);
  getSaidas(...); getNfs(...); getContasPagar(filtro); getContasReceber(filtro);
  getDespesas(filtro); getTiposDespesa(); getCartaoVendas(filiais, ini, fim);
  getPedidosCompra(filtro); getPedidoCompraProdutos(id); getPedidoCompraDistribuicao(id);
  getPedidosVenda(filtro); getVerbas(filial, ini, fim); getPrevisao(filial, ano, mes, escopo);
  getStatus();  // health-check
  // escrita (fase 8, feature-flag)
  postCliente(dto); postOferta(dto); postPedidoCompra(dto); postPedidoVenda(dto);
  postAcertoEstoque(kind, dto); deleteAcertoEstoque(kind, filial, id);
  postGtin(idProduto); deleteGtins(gtins[]); postBaixaCartoes(dto); patchVendaCartao(chave, dto);
}
```

Cada operação declara: rota, params, schema de resposta, rota exigida no token (p/ verificação
prévia contra `routes_granted` — falha rápida com erro claro "rota não contratada").

## 6. Mapa de dependências externas

| Sistema | Direção | Protocolo | Criticidade |
|---|---|---|---|
| ERP SG do tenant | DashSGS → ERP | HTTPS/VPN + JWT | Núcleo (sem ele, dados congelam; dashboard segue com último snapshot) |
| SMTP transacional | DashSGS → provedor | HTTPS | Alertas/convites (fila com retry) |
| DNS/NTP | infra | — | Suporte |
| (futuro) Slack/WhatsApp | DashSGS → provedor | HTTPS | Notificações opcionais |

## 7. Testes de contrato

- Suite nightly contra homologação SG (credenciais de homologação): 1 chamada de cada GET
  essencial validando schema; relatório de drift.
- Mocks locais gerados dos exemplos da coleção Postman (fixtures versionadas) para CI.
- Alarme quando `routes` do token divergir do esperado ou schema quebrar (doc 18).

## 8. Erros da API SG → erros internos

| SG | Interno | Ação |
|---|---|---|
| 401 na autorização | `ERP_CREDENTIALS_INVALID` | status conexão error + alerta admin tenant |
| 401 em rota | `ERP_TOKEN_EXPIRED` (1º) / `ERP_ROUTE_FORBIDDEN` (2º) | refresh; se persistir, marcar rota indisponível |
| 400 "Parametros obrigatorios..." | `ERP_BAD_REQUEST` (bug nosso) | Sentry, não retry |
| 400/404 não encontrado | `ERP_NOT_FOUND` | tratar como vazio |
| 500 | `ERP_SERVER_ERROR` | retry (GET), circuit breaker |
| timeout/ECONNREFUSED | `ERP_UNREACHABLE` | retry, circuit breaker, health-check |

## 9. Estado da implementação (Fase 5)

| Spec | Implementação |
|---|---|
| §1 Configuração por tenant | `apps/api/src/modules/erp-connection/` + tabela `app_erp_connections` (RLS estrita) |
| §1 Anti-SSRF no `base_url` | `apps/api/src/integration/sg/http/url-guard.ts` |
| §2 Token manager | `apps/api/src/integration/sg/sg-token.manager.ts` (cache Redis 50 min, lock single-flight, diff de `routes`) |
| §3 Cliente HTTP | `apps/api/src/integration/sg/http/sg-http.client.ts` + `sg-rate-limiter.ts` + `sg-circuit-breaker.ts` |
| §4 Normalização | `apps/api/src/integration/sg/normalizers.ts` |
| §5 Catálogo tipado | `apps/api/src/integration/sg/sg.client.ts` + schemas em `types/index.ts` |
| §7 Contrato nightly | `apps/api/test/contract/sg-contract.spec.ts` + `.github/workflows/contract-nightly.yml` |
| §7 Mocks locais | `apps/api/src/integration/sg/mock/` (`SG_MOCK=true`) |
| §8 Taxonomia de erros | `apps/api/src/integration/sg/sg-errors.ts` |
| Wizard + health | `apps/web/src/app/admin/conexao-erp/` |

Decisões tomadas na implementação:

- **O schema zod é a allowlist.** Campo que não está no schema não entra no sistema — a
  minimização de dados (doc 26) fica garantida pela porta de entrada, não por disciplina de quem
  escreve mapper depois.
- **Item inválido é posto em quarentena, não derruba a página.** Uma linha estranha em 5.000
  produtos não pode interromper o sync; o que ela gera é `sg_invalid_items_total` com o recurso,
  para virar alerta quando deixar de ser exceção.
- **A verificação anti-SSRF roda a cada requisição**, não só no cadastro: entre o cadastro e a
  chamada o DNS pode mudar (rebinding). Redirecionamento é recusado (`redirect: 'error'`) pelo
  mesmo motivo — seguir um 302 pularia o guarda.
- **Retry só em GET.** A API SG não oferece idempotência; repetir uma escrita seria inventar um
  risco que a spec não autoriza (doc 03 §Ações).
- **A senha do ERP é write-only.** O cofre usa a mesma cifra de envelope do TOTP (E2-04); a UI
  mostra "nova senha" e o valor nunca volta para a tela — testado no E2E pelo HTML inteiro.
- **O formato do header é descoberto em execução e agora PERSISTIDO** (doc 34 Q2): tenta
  `Authorization: <jwt>`, e em 401 repete uma vez com `Bearer <jwt>`, gravando o que funcionou na
  conexão do tenant. Antes a descoberta vivia só no cache do token (50 min) e se perdia a cada
  renovação — uma instalação que exige `bearer` pagava um 401 de aprendizado por ciclo, sempre.
- **Modo VPN não é "aceitar rede privada": é "estar dentro do túnel".** O destino precisa cair
  numa das faixas de `SG_VPN_CIDR` (que aceita lista), **público ou privado**. Endereço público
  em modo VPN é recusado: o sigilo ali vem do túnel, e aceitar fora dele deixava passar
  `http://host-publico` com a auditoria registrando "vpn" (doc 34 §4.4) — runbook 22 §7.
- **429 é falha própria e retentável.** O cliente respeita `Retry-After` (em segundos ou data),
  com teto de 60 s para não prender o worker. Antes, "reduza o ritmo" caía em `resposta_invalida`
  e a página do cliente ia para a quarentena (doc 34 Q3).
- **Tamanho de página degrada sozinho.** Endpoint que recusa o tamanho com 400 faz o cliente
  cortar pela metade, até o piso `SG_PAGE_SIZE_MIN`, e gravar o teto que passou em
  `pageSizePorRota` — é a Q4 se respondendo sozinha, por endpoint.

Ainda não implementado deste doc: as rotas da coleção que só a Fase 6 consome (financeiro,
compras, perdas, previsão) entram junto com seus jobs de sync, como manda o doc 24 §7 — tipo sem
consumidor envelhece sem ninguém perceber.
