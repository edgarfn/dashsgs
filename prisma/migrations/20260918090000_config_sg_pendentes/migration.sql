-- Respostas pendentes da SG viram configuração ajustável (doc 34 Q1–Q5).
--
-- Enquanto a SG não responde, cada suposição que estava cravada no código passa a ter um lugar
-- por tenant, com padrão conservador vindo da instalação. O objetivo não é adivinhar a resposta:
-- é que a resposta, quando vier, seja um UPDATE e não um deploy.

-- Q5 — prefixo da API. Vazio (NULL) mantém exatamente o comportamento de hoje: `/public` só na
-- autorização do SG Cloud. Se a SG responder "vale para todas as rotas", grava-se '/public' aqui.
ALTER TABLE "app_erp_connections" ADD COLUMN "api_path_prefix" VARCHAR(60);

-- Q4 — itens por página. NULL = usa SG_PAGE_SIZE da instalação; a coluna por rota guarda o teto
-- que a degradação automática descobriu, por endpoint.
ALTER TABLE "app_erp_connections" ADD COLUMN "page_size" INTEGER;
ALTER TABLE "app_erp_connections" ADD COLUMN "page_size_por_rota" JSONB;

-- Sem backfill de propósito: NULL significa "herda o padrão da instalação", e é assim que uma
-- conexão existente continua se comportando exatamente como antes desta migração.
