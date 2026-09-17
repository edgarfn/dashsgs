# 30 — Architecture Decision Records

Formato compacto: Contexto → Opções → Decisão → Consequências. Status: todos **Aceitos** na
especificação (revisáveis com evidência nova).

## ADR-001 — Monolito modular (não microserviços)
**Contexto**: equipe pequena, MVP, domínio coeso. **Opções**: microserviços; monolito modular;
serverless. **Decisão**: monolito NestJS com módulos bem separados + workers no mesmo codebase
(processos distintos). **Consequências**: deploy simples, refatoração barata; disciplina de
fronteiras via módulos; extração futura possível (integration/sg e sync são candidatos).

## ADR-002 — PostgreSQL como único banco
**Contexto**: dados relacionais + séries de fatos + necessidade de isolamento. **Opções**: PG;
MySQL; PG+ClickHouse. **Decisão**: PostgreSQL 17 (RLS, partições, window functions).
**Consequências**: sem RLS não haveria defesa em profundidade equivalente; ClickHouse adiado até
volumetria real exigir (agregados materializados seguram o MVP).

## ADR-003 — Multi-tenancy: shared schema + RLS
**Contexto**: ≤50 tenants no MVP; custo operacional. **Opções**: shared+RLS; schema/tenant;
DB/tenant. **Decisão**: shared com `tenant_id` + RLS FORCE + testes de isolamento como gate.
**Consequências**: operação simples; blast radius lógico mitigado por RLS+testes; design permite
extração de tenant para DB dedicado (enterprise) sem reescrita.

## ADR-004 — Sessões server-side (não JWT) para usuários
**Contexto**: necessidade de revogação imediata e MFA. **Opções**: JWT+refresh; sessão opaca.
**Decisão**: sessão opaca em Postgres com cache Redis; cookie __Host httpOnly. **Consequências**:
logout/lock instantâneos; 1 lookup por request (aceitável); horizontal scale ok (estado no
banco, não no processo).

## ADR-005 — RBAC estático em código (não builder de papéis)
**Contexto**: previsibilidade e testabilidade de permissões no MVP. **Decisão**: catálogo de
permissões e papéis versionado; flags pontuais (erp.approve, filiais_allowed).
**Consequências**: matriz testável exaustivamente; menos flexível — papéis custom ficam para
demanda real.

## ADR-006 — Integração SG: pull + espelho local (não proxy passthrough)
**Contexto**: API sem webhooks, token 1 h, janelas 30 d, latência/risco de acoplar UI ao ERP.
**Opções**: chamar ERP por request do usuário; espelho sincronizado. **Decisão**: espelho + 
agregados; ERP nunca no caminho do request (exceto ações aprovadas). **Consequências**:
dashboard rápido e disponível mesmo com ERP fora; custo: pipeline de sync e frescor eventual
(mitigado por selo de horário).

## ADR-007 — Cache: Redis com invalidação por evento + TTL curto
**Decisão**: cache-aside com chave prefixada por tenant, TTL 60 s–12 h por classe, invalidação
disparada por `sync.domain.completed`. **Consequências**: simplicidade; aceita janela de
staleness igual ao TTL; proibição de cache sem prefixo é lint+teste.

## ADR-008 — Filas: BullMQ sobre Redis
**Contexto**: retry/backoff/repeatable/locks necessários; um broker a menos. **Alternativa**:
RabbitMQ/SQS. **Decisão**: BullMQ. **Consequências**: Redis vira componente crítico (já é, pelo
cache); DLQ e painéis via Bull Board; se exigirmos garantias mais fortes, revisitar.

## ADR-009 — Logs estruturados com redaction obrigatória
**Decisão**: pino + processor de redaction (allowlist de campos); PII proibida; correlation id
fim-a-fim. **Consequências**: diagnóstico sem risco de vazamento; exige disciplina nos eventos.

## ADR-010 — Auditoria append-only com hash chain no Postgres
**Contexto**: exigência de auditabilidade à prova de adulteração sem infra extra. **Opções**:
tabela comum; WORM externo; blockchain-like interno. **Decisão**: tabela sem UPDATE/DELETE +
`entry_hash=sha256(prev||row)` + export mensal assinado p/ storage imutável. **Consequências**:
adulteração detectável; verificação periódica automatizável; custo mínimo.

## ADR-011 — Segurança de credencial ERP: envelope AES-256-GCM
**Decisão**: cifra por coluna com chave mestra versionada fora do banco (SOPS/KMS), write-only
na UI, redaction em logs, acesso só pelo token manager. **Consequências**: DBA não lê segredos;
rotação sem downtime (rewrap); dependência da guarda da chave mestra (2 cofres).

## ADR-012 — Privacidade: minimização na ingestão (allowlist)
**Decisão**: mappers só persistem campos aprovados; módulo Clientes opt-in com subconjunto
mínimo; CPF hash+máscara; campos vetados nunca entram (endereço/telefone/nascimento/gênero de
consumidores, mercafacil.cpfcnpj). **Consequências**: reduz radicalmente superfície LGPD; se um
tenant precisar de mais campos, é decisão consciente com DPIA — não default.

## ADR-013 — Deploy MVP: Docker Compose em VM (não Kubernetes)
**Contexto**: 1–2 devs; carga inicial modesta. **Decisão**: Compose + Caddy + deploy por digest;
Postgres gerenciado assim que houver receita. **Consequências**: operação mínima; limite de
escala conhecido (vertical + réplicas manuais); gatilho de migração p/ K8s documentado
(multi-VM, autoscaling ou exigência de cliente).

## ADR-014 — Gráficos do MVP em SVG no servidor (ECharts fica para quando houver interação)
**Contexto**: o doc 04 escolheu ECharts para a camada de visualização, e o doc 16 §5 fixa um
orçamento de 250 kB gz no bundle inicial e LCP < 2,5 s em 4G. As telas da Fase 7 desenham uma
curva de 24 pontos, séries de até 90 barras e rankings de meia dúzia de itens.
**Opções**: (a) ECharts desde já; (b) SVG renderizado no servidor; (c) imagem gerada no backend.
**Decisão**: (b) — componentes SVG server-side, sem JavaScript de página, cada gráfico com a
tabela equivalente num bloco "ver dados" — o requisito de leitor de tela do doc 16 §5.
**Consequências**: o bundle inicial ficou em ~102 kB gz (contra ~400 kB com ECharts), as telas
funcionam sem JS e a acessibilidade sai de graça; em troca não há zoom, brush nem tooltip rico.
**Gatilho de revisão**: a primeira tela que precisar de interação de verdade no gráfico
(drill-down por clique na série, seleção de intervalo, séries longas com decimação) traz o
ECharts junto — carregado só naquela rota, não no bundle compartilhado.

## ADR-015 — Medida de barra em classe CSS, não em atributo `style`
**Contexto**: a CSP de produção (doc 09 §1) não abre exceção para inline, e `style-src` governa
também o atributo `style`. As barras dos gráficos da Fase 7 levavam `style={{ width: '42%' }}` —
a declaração é descartada **em silêncio**, a barra fica com 0px e o teste de conteúdo continua
passando. As 100 violações só apareceram quando a suíte passou a rodar contra o build de
produção; em `NODE_ENV=development` a CSP permissiva as escondia.
**Opções**: (a) `unsafe-inline` em `style-src`; (b) `<style>` com nonce por requisição, com uma
regra por barra; (c) classes utilitárias de percentual na folha estática.
**Decisão**: (c). `medida-largura`/`medida-altura` escolhem o eixo e `medida-N` publica o
percentual numa variável CSS; o helper `classeProporcao()` é o único caminho para dizer "esta
barra vale 42%".
**Consequências**: a medida sai do HTML e entra na folha, que a CSP libera por origem; funciona
igual em componente de servidor e de cliente (não depende do nonce da requisição); a folha ganha
101 regras que gzipam para quase nada. O custo é arredondar para 1% — no máximo ~2px numa barra
de 200px. (a) foi descartada por devolver ao atacante exatamente o vetor que a CSP existe para
fechar; (b), por exigir plumbing de nonce até dentro de componente de cliente, para ganhar
precisão que ninguém enxerga.
**Gatilho de revisão**: um gráfico que precise de precisão sub-1% — uma régua, um comparativo de
milésimos — pede o `<style>` com nonce naquela tela.

## ADR-016 — Vocabulário de rótulos como contrato verificável da métrica
**Contexto**: a Fase 10 transcreveu os alertas do doc 18 §5 para regras do Prometheus. Dois dos
doze casavam valores de rótulo que o código nunca emite — `sg_token_refresh_total{result=
"unauthorized"}` (o real é `credenciais_invalidas`) e `alert_notifications_total{result="erro"}`
(o real é `failed`). Regra assim não falha, não avisa e não dispara: fica silenciosa para
sempre, e o sintoma é indistinguível de "está tudo bem".
**Opções**: (a) revisão humana atenta; (b) teste que sobe a stack e espera o alerta disparar;
(c) declarar o vocabulário dos rótulos de cardinalidade fechada e conferir as regras contra ele
no CI.
**Decisão**: (c). `VOCABULARIO_METRICAS` em `metrics.service.ts` lista, por métrica, os valores
possíveis de cada rótulo fechado; `scripts/check-observability.mjs` extrai os matchers das
regras e dos painéis e reprova o que não existe. `SgFalha` deixou de ser só um tipo e virou
array em runtime — tipo não existe na hora de conferir um YAML.
**Consequências**: o gate custa segundos e pega a classe inteira de erro, incluindo métrica com
nome plausível e inexistente e alerta sem `runbook`. O preço é um segundo lugar para manter
(o vocabulário), mitigado por `metrics-vocabulario.spec.ts`, que compara a cópia com a fonte.
Rótulo aberto — `tenant`, `route`, `endpoint`, `queue`, `policy`, `domain` — fica de fora por
construção: listá-lo faria o gate reprovar um tenant novo.
**Gatilho de revisão**: se um dia as regras forem geradas a partir do código (em vez de escritas
à mão), o gate vira redundante e sai junto.

## ADR-017 — WAL-G dentro da imagem do Postgres (e a base em glibc)
**Contexto**: o doc 20 §1 promete RPO de 1 h, o que exige arquivamento **contínuo** de WAL. O
`archive_command` roda dentro do processo do Postgres, com acesso ao `pg_wal`.
**Opções**: (a) sidecar com WAL-G, fazendo só base backup; (b) `archive_command` copiando para
um spool local que um sidecar envia; (c) WAL-G embutido na imagem do banco.
**Decisão**: (c). A mesma imagem serve ao banco, ao container de backup e ao teste de
restauração — restaurar com um binário diferente do que gravou é testar outra coisa. Como os
binários oficiais do WAL-G são ligados à glibc, a base passou de `postgres:17-alpine` para
`postgres:17-bookworm`.
**Consequências**: RPO de 1 h real, com `wal-push` falhando de forma segura (o Postgres segura o
WAL e tenta de novo, e disco cheio tem alerta). Duas contrapartidas conscientes: a troca de base
teria exigido `REINDEX DATABASE` se houvesse dados — glibc e musl ordenam texto diferente, e
índice lido sob outra collation devolve resultado errado sem acusar erro —, por isso foi feita
antes de existir instalação real; e o container do banco passou a ter saída para a internet, em
rede própria (`backup_egress`) e não na `edge`, sem porta publicada e sem vizinhança com o proxy
da borda. (b) foi descartada por perder a propriedade mais valiosa do `archive_command`: falhar
para trás em vez de descartar WAL em silêncio.
**Gatilho de revisão**: banco gerenciado (RDS/Cloud SQL) elimina a questão inteira — o
arquivamento passa a ser do provedor, e a imagem volta a ser a oficial.
