# 00 — Resumo Executivo

## O que foi analisado

A **API SG - Terceiros** é a API REST de integração do ERP da SG Sistemas (software de gestão para
varejo alimentar — supermercados, atacarejos e redes com múltiplas filiais). A documentação oficial
é uma coleção Postman publicada (não há OpenAPI/Swagger oficial), com:

- **41 módulos** e **105 endpoints** (92 GET, 9 POST, 1 PATCH, 3 DELETE);
- Autenticação por **JWT (HS256), validade de 1 hora**, obtido com usuário/senha fornecidos pelo
  comercial da SG; o token embute a **lista de rotas autorizadas** para aquele usuário [DOCUMENTADO];
- Cobertura funcional: produtos e estoque, vendas de PDV (dia fechado e **tempo real**), financeiro
  (contas a pagar/receber, despesas, cartões, verbas), compras (pedidos, notas de entrada), notas
  fiscais (entrada/saída/serviço), clientes, vendedores, ofertas e previsão de vendas;
- **Sem webhooks, sem rate limits documentados, sem sandbox self-service** (existe ambiente de
  homologação com credenciais fornecidas pela SG), **sem HTTPS nos exemplos** (host de homologação
  `http://sgps.sgsistemas.com.br:8201`).

## O que será construído

**DashSGS**: plataforma SaaS multi-tenant B2B que conecta-se ao ERP SG de cada cliente (tenant),
sincroniza os dados relevantes para um banco analítico próprio e entrega:

1. **Dashboard executivo em tempo quase-real** — vendas do dia por filial/caixa/hora, ticket médio,
   comparativos e atingimento de meta (previsão de vendas vs. realizado);
2. **Gestão de margem e custos** — margem por dia/filial/departamento/produto usando os 5 tipos de
   custo expostos pela API;
3. **Alertas operacionais** — ruptura (estoque < mínimo), estoque negativo, produtos a vencer,
   perdas anormais, divergências de fechamento (flags do resumo diário), contas a vencer;
4. **Visão financeira** — aging de contas a pagar/receber, despesas por tipo/departamento,
   conciliação de cartões (taxas por adquirente/bandeira);
5. **Visão de compras** — pedidos por situação, lead time de atendimento, verbas de fornecedores;
6. **(Fase posterior, opcional por tenant) Ações no ERP** — criação de ofertas, pedidos de compra e
   acertos de estoque via API, com workflow de aprovação e auditoria completa.

## Por que essa forma de produto

A API é **fortemente orientada a leitura** (92 de 105 endpoints) e expõe dados analíticos que o ERP
não consolida entre filiais/empresas em uma visão executiva na palma da mão. O maior valor está em
**consolidar, historizar e alertar** — exatamente o que a API viabiliza sem inventar nada. As
escritas existentes (ofertas, pedidos, acertos, baixa de cartões) são valiosas, mas de alto risco
(alteram preço, estoque e financeiro do ERP em produção), por isso entram em fase posterior, atrás
de aprovação explícita e trilha de auditoria.

## Princípios inegociáveis do projeto

Privacy by Design/Default · Security by Design/Default · Zero Trust · Least Privilege ·
Defense in Depth · LGPD · Secure SDLC (OWASP ASVS/Top 10/API Top 10/SAMM) · Auditabilidade ·
Observabilidade · Isolamento rigoroso entre tenants (RLS + testes) · Idempotência · Resiliência ·
Minimização e retenção controlada de dados.

## Riscos centrais identificados (detalhe em 33-gap-analysis.md)

1. **Transporte sem TLS documentado** na API SG — mitigar com exigência de HTTPS/VPN por tenant;
2. **Token de 1h sem refresh** e autorização por lista de rotas no próprio JWT — gerenciar ciclo de
   vida do token no backend, jamais no navegador;
3. **Sem rate limit documentado** — implementar rate limiting *cliente* (self-throttling) para não
   degradar o ERP do cliente;
4. **Dados pessoais de consumidores (CPF, endereço, nascimento)** expostos pelo módulo Clientes —
   minimização agressiva: por padrão o DashSGS **não sincroniza PII de clientes**;
5. **Sem webhooks** — arquitetura de sincronização por polling incremental com janelas de 30 dias.

## Estado da análise

- Etapas 1–3 (descoberta, inventário, mapeamento de dados): **concluídas** — ver docs 02 e 03.
- Etapas 4–12 (requisitos, arquitetura, segurança, banco, UX, integrações, testes, roadmap):
  especificadas nesta documentação.
- Próximo passo de implementação: ver 29-roadmap.md (Fase 2 — Foundation) e 31-backlog.md.
