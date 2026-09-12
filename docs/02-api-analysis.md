# 02 — Análise Técnica e Crítica da API SG

## 1. Formato e descoberta

- Documentação = **coleção Postman publicada** (Postman Documenter) em api-doc.sgsistemas.com.br;
  título "API SG - Terceiros"; contato contato@sgsistemas.com.br; publicada em 2025-04-04.
- **Não há OpenAPI/Swagger oficial** [DOCUMENTADO pela ausência]. A coleção JSON completa é
  recuperável do próprio portal e serviu de fonte para o inventário (doc 03).
- Existe um **ambiente publicado "Homologação"**: `base_url = sgps.sgsistemas.com.br:8201`,
  `api_user = homologacao` (senha não publicada) [DOCUMENTADO].
- Produção: instância do próprio cliente (on-premise) ou **SG Cloud**, onde o path de autenticação
  ganha prefixo `/public` [DOCUMENTADO]. Demais rotas no SG Cloud: [NECESSITA CONFIRMAÇÃO] se
  também recebem prefixo.

## 2. Autenticação e autorização [DOCUMENTADO]

- `POST /integracao/sgsistemas/v1/autorizacao` com `{"usuario","senha"}` → `{token, routes[], expire_time}`.
- JWT **HS256**; claims observadas no exemplo: `routes` (lista "MÉTODO /path"), `usuario`,
  `expire_time` (formato `YYYY-MM-DD HH:MM:SS`, sem timezone). Validade: **1 hora**.
- **Autorização por rota embutida no token**: o usuário de integração só acessa as rotas contratadas.
  O exemplo de homologação lista 28 rotas — ou seja, **o conjunto de rotas do contrato pode ser um
  subconjunto do catálogo**; o DashSGS deve tratar 401/403 por rota e degradar funcionalidades.
- Uso: header `Authorization` com o token. Nos exemplos o valor é o JWT puro (variável `{{auth_key}}`);
  um único request declara auth "bearer" no metadata do Postman. Formato exato aceito
  (com/sem prefixo `Bearer `) — [NECESSITA CONFIRMAÇÃO].
- **Não há**: refresh token, revogação documentada, escopos OAuth, mTLS, API keys por header
  dedicado, rotação de senha self-service. Renovação = repetir login.

### Crítica
- Senha trafega em corpo JSON e o host de homologação é **HTTP porta 8201** — sem TLS documentado.
  Isso é inaceitável para produção; ver riscos (doc 33) e exigências de onboarding (doc 12).
- `expire_time` sem timezone: usar o `exp`/hora do servidor com margem (renovar aos ~50 min)
  em vez de confiar no parse do campo.

## 3. Convenções da API

| Aspecto | Comportamento observado |
|---|---|
| Base path | `/integracao/sgsistemas/v1/...` (status: `/sgsistemas/v1/status`) |
| Versionamento | `v1` no path; sem política de depreciação publicada [NECESSITA CONFIRMAÇÃO] |
| Formato | JSON UTF-8; datas `YYYY-MM-DD`; horas `HH:MM`; decimais com ponto |
| Paginação | `pagina` + `itensPorPagina` (query); resposta com envelope `paginacao` **ou** `ordenacao` (inconsistente); campos: pagina, itensPorPagina, quantidadePaginas, quantidadeItens, ordenacao{por,direcao} |
| Sem envelope | `GET /vendascartoes` e `GET /pedidosvenda/produtos` retornam **array puro** |
| Ordenação | `por` + `direcao` (asc/desc), campos variam por endpoint |
| Filtros | Por id, por descrição/nome/documento, por datas (`dataInicial/Final` ou `filtroData*` — nomes inconsistentes), por arrays (`filiais`, `situacoes`, `transacoes`...) |
| Erros | `{"error": "mensagem em PT"}` com 400/401/404/500; sem código interno, sem correlation id |
| Idempotência | Nenhum mecanismo (sem Idempotency-Key); POSTs repetidos podem duplicar [HIPÓTESE — confirmar em homologação] |
| Rate limit | Não documentado [NECESSITA CONFIRMAÇÃO] |
| Timeout | Não documentado; endpoints com flags de cálculo (`emitePISCOFINS`, `emiteCustoSemEncargos`) até 3x mais lentos [DOCUMENTADO] |
| Webhooks/eventos | **Inexistentes** — integração é 100% pull |
| Upload/download | Inexistentes |
| Campo extra de rastreio | `idPedidoIntegrador`/`idPedidoIntegrado`/`idExterno` nos pedidos — chave de correlação do integrador (nossa arma de idempotência de negócio) |

## 4. Inconsistências que a camada anticorrupção deve absorver

1. Envelope `paginacao` vs `ordenacao` vs array puro.
2. Nome do filtro de data varia: `dataInicial/dataFinal` vs `filtroDataInicial/filtroDataFinal`.
3. `tipoEntidade` ora vem por extenso ("Fornecedor"), ora código ("C") + `descricaoTipoEntidade`.
4. Strings com padding de espaços (ids de oferta, gôndola, série).
5. Pseudo-booleans em char (`" "`, `"S"`, `"C"`) convivendo com booleans JSON.
6. Exemplo com `idGTIN: false` (tipo instável em `/pedidosvenda/produtos`).
7. `Vendas Hoje` não traz `idVendedor` (o dia fechado traz) — schemas divergem entre "hoje" e histórico.
8. Erros 400 usados para "não encontrado" em alguns módulos e 404 em outros.

## 5. Mapeamento e classificação de dados (síntese; matriz completa no doc 10)

| Classe | Dados | Endpoints |
|---|---|---|
| PERSONAL_DATA | Nome, CPF/CNPJ*, RG, endereço, CEP, telefone, celular, e-mail, gênero, data de nascimento, observações | /clientes (GET/POST) |
| PERSONAL_DATA | Nome, CPF, comissões, dias de rota | /vendedores |
| PERSONAL_DATA (indireta) | idCliente na venda; mercafacil.cpfcnpj | /vendas, /vendas/hoje |
| PERSONAL_DATA (colaborador) | usuário do ERP em textos (`usuario`, `usuarioGravacao`, `aprovadoPor`) | /despesas, /pedidoscompra, /filiais/vendas |
| FINANCIAL | Custos, margens, contas, despesas, taxas de cartão, verbas, limites de crédito | financeiro/produtos |
| CONFIDENTIAL | Previsões de venda/lucro, curva ABC, política de preços | /previsaovendas, /produtos |
| SECURITY_SENSITIVE | usuario/senha da integração; JWT; chave NF-e | /autorizacao, /entradas/chave, /saidas/chave |
| INTERNAL | Dimensões (departamentos, marcas, municípios, unidades...) | demais |

*CPF/CNPJ de PF é dado pessoal; de PJ identifica empresa (ainda assim tratar com cuidado).

**Sensíveis (art. 5º II LGPD)**: nenhum dado sensível stricto sensu é exposto (não há saúde,
biometria, religião...). `genero` é dado pessoal comum, mas de baixa necessidade para o produto —
**não sincronizar** (minimização).

## 6. Análise de segurança da API (visão consumidor — OWASP API Security Top 10)

| # | Risco | Avaliação nesta API | Impacto p/ DashSGS | Mitigação no nosso lado |
|---|---|---|---|---|
| API1 BOLA | IDs sequenciais (produtos, clientes, notas); autorização é por **rota**, não por objeto | Se as credenciais vazarem, toda a base daquela instância é enumerável | Segregar credenciais por tenant; cofre; nunca expor a API SG ao browser |
| API2 Broken Auth | Senha estática + token 1h sem revogação documentada; HTTP em homologação | Vazamento = acesso até troca manual de senha | TLS obrigatório, rotação periódica com a SG, monitorar uso anômalo |
| API3 Property-level | GETs retornam objetos completos (ex.: cliente com todos os campos) | Superexposição de PII | Minimização na ingestão: descartar campos não usados **antes** de persistir |
| API4 Resource Consumption | Sem rate limit documentado; endpoints caros (PIS/COFINS 3x) | Podemos degradar o ERP do cliente | Rate limiting cliente por tenant, janelas, backoff, horários de menor movimento |
| API5 Function-level | Rotas de escrita liberadas por contrato no token | Usuário de integração com escrita desnecessária | Pedir à SG credenciais **somente-leitura** por padrão (least privilege) |
| API6 Sensitive business flows | POST /ofertas muda preço de loja; POST /vendascartoes baixa financeiro | Automação maliciosa/errada causa prejuízo real | Workflow de aprovação, limites, auditoria, feature-flag por tenant |
| API7 SSRF | `base_url` é configurável por tenant no DashSGS | SSRF **no nosso produto** via URL maliciosa | Validação/allowlist de host, bloquear IPs privados, egress proxy |
| API8 Misconfiguration | HTTP, mensagens de erro cruas | MITM, info leak | Exigir HTTPS/VPN; não repassar erros crus ao usuário |
| API9 Inventory | Sem OpenAPI; catálogo real por contrato varia | Drift de contrato | Testes de contrato periódicos em homologação; monitorar `routes` do token |
| API10 Unsafe consumption | Respostas do ERP entram no nosso pipeline | Injeção via dados (XSS armazenado em descrições) | Validar/sanitizar tudo que vem da API antes de persistir/renderizar |

## 7. Limites conhecidos e implicações de arquitetura

1. **Pull-only** → scheduler + workers de sincronização (doc 14).
2. **Janela de 30 dias** em séries históricas → backfill em fatias.
3. **`/vendas` exige data única e filial** → uma chamada por dia×filial; paralelismo controlado.
4. **Volumetria real de exemplo**: ~40.895 produtos, ~90k GTINs numa base de homologação → paginação
   obrigatória com `itensPorPagina` alto porém seguro (ex.: 500) [RECOMENDAÇÃO; limite máximo aceito
   pela API: NECESSITA CONFIRMAÇÃO].
5. **Token por instância** → gerenciador de token por tenant com cache e renovação antecipada.
6. **Flags de fechamento** (`gerouVendasDiaria` etc.) → orquestrar sync do dia fechado somente após
   fechamento; usar `/vendas/hoje` para tempo real com semântica "provisória".
