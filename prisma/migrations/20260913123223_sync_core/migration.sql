-- CreateEnum
CREATE TYPE "sync_status" AS ENUM ('idle', 'running', 'error');

-- CreateEnum
CREATE TYPE "sync_run_status" AS ENUM ('running', 'success', 'error', 'skipped');

-- CreateTable
CREATE TABLE "sync_watermarks" (
    "tenant_id" UUID NOT NULL,
    "domain" VARCHAR(40) NOT NULL,
    "filial_erp_id" INTEGER NOT NULL DEFAULT 0,
    "watermark_date" DATE,
    "watermark_ts" TIMESTAMPTZ(6),
    "cursor" JSONB,
    "status" "sync_status" NOT NULL DEFAULT 'idle',
    "last_success_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(300),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sync_watermarks_pkey" PRIMARY KEY ("tenant_id","domain","filial_erp_id")
);

-- CreateTable
CREATE TABLE "sync_job_runs" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain" VARCHAR(40) NOT NULL,
    "filial_erp_id" INTEGER,
    "trigger" VARCHAR(20) NOT NULL DEFAULT 'scheduler',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "status" "sync_run_status" NOT NULL DEFAULT 'running',
    "pages" INTEGER NOT NULL DEFAULT 0,
    "items" INTEGER NOT NULL DEFAULT 0,
    "api_calls" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error" VARCHAR(300),

    CONSTRAINT "sync_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_api_call_log" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "endpoint" VARCHAR(120) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "http_status" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "items" INTEGER NOT NULL DEFAULT 0,
    "called_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_api_call_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_departamentos_n1" (
    "tenant_id" UUID NOT NULL,
    "erp_id" VARCHAR(20) NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "parent_next_level_erp_id" VARCHAR(20),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_departamentos_n1_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_departamentos_n2" (
    "tenant_id" UUID NOT NULL,
    "erp_id" VARCHAR(20) NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "parent_next_level_erp_id" VARCHAR(20),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_departamentos_n2_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_departamentos_n3" (
    "tenant_id" UUID NOT NULL,
    "erp_id" VARCHAR(20) NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "parent_next_level_erp_id" VARCHAR(20),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_departamentos_n3_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_departamentos_n4" (
    "tenant_id" UUID NOT NULL,
    "erp_id" VARCHAR(20) NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "parent_next_level_erp_id" VARCHAR(20),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_departamentos_n4_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_departamentos_n5" (
    "tenant_id" UUID NOT NULL,
    "erp_id" VARCHAR(20) NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "parent_next_level_erp_id" VARCHAR(20),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_departamentos_n5_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_departamentos_n6" (
    "tenant_id" UUID NOT NULL,
    "erp_id" VARCHAR(20) NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "parent_next_level_erp_id" VARCHAR(20),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_departamentos_n6_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_marcas" (
    "tenant_id" UUID NOT NULL,
    "erp_id" VARCHAR(20) NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_marcas_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_classes" (
    "tenant_id" UUID NOT NULL,
    "erp_id" VARCHAR(20) NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_classes_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_agrupamentos" (
    "tenant_id" UUID NOT NULL,
    "erp_id" VARCHAR(20) NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_agrupamentos_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_unidades_medida" (
    "tenant_id" UUID NOT NULL,
    "erp_id" VARCHAR(20) NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_unidades_medida_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_produtos" (
    "tenant_id" UUID NOT NULL,
    "filial_erp_id" INTEGER NOT NULL,
    "erp_id" INTEGER NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "dep1_erp_id" VARCHAR(20),
    "marca_erp_id" VARCHAR(20),
    "classe_erp_id" VARCHAR(20),
    "agrup_erp_id" VARCHAR(20),
    "unidade_medida" VARCHAR(10),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "balanca" BOOLEAN NOT NULL DEFAULT false,
    "curva_abc" VARCHAR(3),
    "custo_real" DECIMAL(14,4),
    "custo_fiscal" DECIMAL(14,4),
    "custo_com_encargos" DECIMAL(14,4),
    "custo_medio" DECIMAL(14,4),
    "preco_custo" DECIMAL(14,4),
    "preco_venda1" DECIMAL(14,4),
    "preco_venda2" DECIMAL(14,4),
    "estoque_atual" DECIMAL(14,4),
    "estoque_minimo" DECIMAL(14,4),
    "estoque_maximo" DECIMAL(14,4),
    "estoque_trocas" DECIMAL(14,4),
    "venda_media_diaria" DECIMAL(14,4),
    "data_cadastro" DATE,
    "data_alt_preco" DATE,
    "data_alt_custo" DATE,
    "data_alt_cadastro" DATE,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_produtos_pkey" PRIMARY KEY ("tenant_id","filial_erp_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_gtins" (
    "tenant_id" UUID NOT NULL,
    "gtin" VARCHAR(20) NOT NULL,
    "produto_erp_id" INTEGER NOT NULL,
    "qtd_por_embalagem" DECIMAL(14,4),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_gtins_pkey" PRIMARY KEY ("tenant_id","gtin")
);

-- CreateTable
CREATE TABLE "erp_vendas_cupons" (
    "tenant_id" UUID NOT NULL,
    "filial_erp_id" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "caixa" INTEGER NOT NULL,
    "cupom" INTEGER NOT NULL,
    "serie_nfc" VARCHAR(10),
    "horario" VARCHAR(5),
    "cliente_erp_id" INTEGER,
    "identificada" BOOLEAN NOT NULL DEFAULT false,
    "vendedor_erp_id" INTEGER,
    "cancelada" BOOLEAN NOT NULL DEFAULT false,
    "valor_total" DECIMAL(14,4) NOT NULL,
    "is_realtime" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_vendas_cupons_pkey" PRIMARY KEY ("tenant_id","filial_erp_id","data","caixa","cupom")
);

-- CreateTable
CREATE TABLE "erp_venda_itens" (
    "tenant_id" UUID NOT NULL,
    "filial_erp_id" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "caixa" INTEGER NOT NULL,
    "cupom" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL,
    "produto_erp_id" INTEGER,
    "gtin" VARCHAR(20),
    "quantidade" DECIMAL(14,4) NOT NULL,
    "preco_venda" DECIMAL(14,4) NOT NULL,
    "desconto" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "acrescimo" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "oferta_erp_id" VARCHAR(20),
    "pedido_venda_erp_id" INTEGER,
    "icms_base" DECIMAL(14,4),
    "icms_aliq" DECIMAL(7,4),
    "icms_valor" DECIMAL(14,4),
    "pis_base" DECIMAL(14,4),
    "cofins_base" DECIMAL(14,4),
    "tipo_tributacao" VARCHAR(10),
    "modelo_doc" VARCHAR(10),
    "is_realtime" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_venda_itens_pkey" PRIMARY KEY ("tenant_id","filial_erp_id","data","caixa","cupom","ordem")
);

-- CreateTable
CREATE TABLE "erp_finalizadora_lancamentos" (
    "tenant_id" UUID NOT NULL,
    "filial_erp_id" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "caixa" INTEGER NOT NULL,
    "cupom" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL,
    "especie" VARCHAR(40) NOT NULL,
    "valor" DECIMAL(14,4) NOT NULL,
    "cancelada" BOOLEAN NOT NULL DEFAULT false,
    "is_realtime" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_finalizadora_lancamentos_pkey" PRIMARY KEY ("tenant_id","filial_erp_id","data","caixa","cupom","ordem")
);

-- CreateTable
CREATE TABLE "erp_filial_venda_resumo" (
    "tenant_id" UUID NOT NULL,
    "filial_erp_id" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "valor" DECIMAL(14,4) NOT NULL,
    "custo_real" DECIMAL(14,4),
    "custo_sem_icms" DECIMAL(14,4),
    "custo_com_encargos" DECIMAL(14,4),
    "custo_medio" DECIMAL(14,4),
    "custo_fiscal_medio" DECIMAL(14,4),
    "aliq_media_icms" DECIMAL(7,4),
    "aliq_media_pis_cofins" DECIMAL(7,4),
    "qtd_clientes" INTEGER,
    "qtd_unidades" DECIMAL(14,4),
    "prod_com_venda" INTEGER,
    "prod_estoque_abaixo_min" INTEGER,
    "prod_estoque_negativo" INTEGER,
    "prod_estoque_sem_venda" INTEGER,
    "margem_acima" INTEGER,
    "margem_abaixo" INTEGER,
    "margem_negativa" INTEGER,
    "atualizou_estoque" BOOLEAN NOT NULL DEFAULT false,
    "gerou_vendas_diaria" BOOLEAN NOT NULL DEFAULT false,
    "exportou_vendas" BOOLEAN NOT NULL DEFAULT false,
    "processou_scanntech" BOOLEAN NOT NULL DEFAULT false,
    "possui_divergencia" BOOLEAN NOT NULL DEFAULT false,
    "usuario_atualizou_estoque" VARCHAR(60),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_filial_venda_resumo_pkey" PRIMARY KEY ("tenant_id","filial_erp_id","data")
);

-- CreateTable
CREATE TABLE "agg_vendas_hora" (
    "tenant_id" UUID NOT NULL,
    "filial_erp_id" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "hora" INTEGER NOT NULL,
    "valor" DECIMAL(14,4) NOT NULL,
    "cupons" INTEGER NOT NULL,
    "itens" DECIMAL(14,4) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agg_vendas_hora_pkey" PRIMARY KEY ("tenant_id","filial_erp_id","data","hora")
);

-- CreateTable
CREATE TABLE "agg_vendas_dia_dep" (
    "tenant_id" UUID NOT NULL,
    "filial_erp_id" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "dep1_erp_id" VARCHAR(20) NOT NULL,
    "valor" DECIMAL(14,4) NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "custo" DECIMAL(14,4),
    "margem" DECIMAL(14,4),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agg_vendas_dia_dep_pkey" PRIMARY KEY ("tenant_id","filial_erp_id","data","dep1_erp_id")
);

-- CreateIndex
CREATE INDEX "sync_watermarks_tenant_id_status_idx" ON "sync_watermarks"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "sync_job_runs_tenant_id_domain_started_at_idx" ON "sync_job_runs"("tenant_id", "domain", "started_at");

-- CreateIndex
CREATE INDEX "sync_job_runs_tenant_id_status_idx" ON "sync_job_runs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "sync_api_call_log_tenant_id_called_at_idx" ON "sync_api_call_log"("tenant_id", "called_at");

-- CreateIndex
CREATE INDEX "erp_departamentos_n1_tenant_id_synced_at_idx" ON "erp_departamentos_n1"("tenant_id", "synced_at");

-- CreateIndex
CREATE INDEX "erp_departamentos_n2_tenant_id_synced_at_idx" ON "erp_departamentos_n2"("tenant_id", "synced_at");

-- CreateIndex
CREATE INDEX "erp_departamentos_n3_tenant_id_synced_at_idx" ON "erp_departamentos_n3"("tenant_id", "synced_at");

-- CreateIndex
CREATE INDEX "erp_departamentos_n4_tenant_id_synced_at_idx" ON "erp_departamentos_n4"("tenant_id", "synced_at");

-- CreateIndex
CREATE INDEX "erp_departamentos_n5_tenant_id_synced_at_idx" ON "erp_departamentos_n5"("tenant_id", "synced_at");

-- CreateIndex
CREATE INDEX "erp_departamentos_n6_tenant_id_synced_at_idx" ON "erp_departamentos_n6"("tenant_id", "synced_at");

-- CreateIndex
CREATE INDEX "erp_marcas_tenant_id_synced_at_idx" ON "erp_marcas"("tenant_id", "synced_at");

-- CreateIndex
CREATE INDEX "erp_classes_tenant_id_synced_at_idx" ON "erp_classes"("tenant_id", "synced_at");

-- CreateIndex
CREATE INDEX "erp_agrupamentos_tenant_id_synced_at_idx" ON "erp_agrupamentos"("tenant_id", "synced_at");

-- CreateIndex
CREATE INDEX "erp_unidades_medida_tenant_id_synced_at_idx" ON "erp_unidades_medida"("tenant_id", "synced_at");

-- CreateIndex
CREATE INDEX "erp_produtos_tenant_id_synced_at_idx" ON "erp_produtos"("tenant_id", "synced_at");

-- CreateIndex
CREATE INDEX "erp_produtos_tenant_id_dep1_erp_id_idx" ON "erp_produtos"("tenant_id", "dep1_erp_id");

-- CreateIndex
CREATE INDEX "erp_produtos_tenant_id_ativo_estoque_atual_idx" ON "erp_produtos"("tenant_id", "ativo", "estoque_atual");

-- CreateIndex
CREATE INDEX "erp_gtins_tenant_id_produto_erp_id_idx" ON "erp_gtins"("tenant_id", "produto_erp_id");

-- CreateIndex
CREATE INDEX "erp_vendas_cupons_tenant_id_data_idx" ON "erp_vendas_cupons"("tenant_id", "data");

-- CreateIndex
CREATE INDEX "erp_vendas_cupons_tenant_id_filial_erp_id_data_is_realtime_idx" ON "erp_vendas_cupons"("tenant_id", "filial_erp_id", "data", "is_realtime");

-- CreateIndex
CREATE INDEX "erp_venda_itens_tenant_id_produto_erp_id_data_idx" ON "erp_venda_itens"("tenant_id", "produto_erp_id", "data");

-- CreateIndex
CREATE INDEX "erp_venda_itens_tenant_id_data_idx" ON "erp_venda_itens"("tenant_id", "data");

-- CreateIndex
CREATE INDEX "erp_finalizadora_lancamentos_tenant_id_data_especie_idx" ON "erp_finalizadora_lancamentos"("tenant_id", "data", "especie");

-- CreateIndex
CREATE INDEX "erp_filial_venda_resumo_tenant_id_data_idx" ON "erp_filial_venda_resumo"("tenant_id", "data");

-- CreateIndex
CREATE INDEX "erp_filial_venda_resumo_tenant_id_gerou_vendas_diaria_data_idx" ON "erp_filial_venda_resumo"("tenant_id", "gerou_vendas_diaria", "data");

-- CreateIndex
CREATE INDEX "agg_vendas_hora_tenant_id_data_idx" ON "agg_vendas_hora"("tenant_id", "data");

-- CreateIndex
CREATE INDEX "agg_vendas_dia_dep_tenant_id_data_idx" ON "agg_vendas_dia_dep"("tenant_id", "data");

-- ---------------------------------------------------------------------------
-- RLS e privilégios (doc 08 §3 / doc 24 §7 passo 3)
--
-- Toda tabela criada acima guarda dado de tenant, então todas recebem o template ESTRITO: sem
-- `app.tenant_id` fixado na transação, a consulta falha em vez de devolver linha alheia. É o que
-- o gate `pnpm db:rls-check` confere no CI.
--
-- Os espelhos `erp_` e os agregados `agg_` também são liberados para `app_readonly` (papel de BI,
-- doc 09 §1): são dados de negócio, não credenciais. O estado de sync fica só com a aplicação.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  tabela text;
  espelhos text[] := ARRAY[
    'erp_departamentos_n1', 'erp_departamentos_n2', 'erp_departamentos_n3',
    'erp_departamentos_n4', 'erp_departamentos_n5', 'erp_departamentos_n6',
    'erp_marcas', 'erp_classes', 'erp_agrupamentos', 'erp_unidades_medida',
    'erp_produtos', 'erp_gtins',
    'erp_vendas_cupons', 'erp_venda_itens', 'erp_finalizadora_lancamentos',
    'erp_filial_venda_resumo',
    'agg_vendas_hora', 'agg_vendas_dia_dep'
  ];
  operacionais text[] := ARRAY['sync_watermarks', 'sync_job_runs', 'sync_api_call_log'];
BEGIN
  FOREACH tabela IN ARRAY espelhos || operacionais LOOP
    CALL app_enable_tenant_rls(tabela);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', tabela);
    END IF;
  END LOOP;

  -- Sequências das tabelas com id bigserial: sem isto o papel da aplicação não consegue inserir.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT USAGE, SELECT ON SEQUENCE sync_job_runs_id_seq TO app_rw;
    GRANT USAGE, SELECT ON SEQUENCE sync_api_call_log_id_seq TO app_rw;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    FOREACH tabela IN ARRAY espelhos LOOP
      EXECUTE format('GRANT SELECT ON %I TO app_readonly', tabela);
    END LOOP;
  END IF;
END;
$$;
