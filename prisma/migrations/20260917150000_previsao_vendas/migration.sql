-- Previsão de vendas (E5-11, doc 03 §Previsão / doc 15 §7).
--
-- Duas tabelas e não uma: o total do mês e a curva diária respondem perguntas diferentes. O total
-- é a meta; a curva é o que permite dizer "estamos atrasados" sem acusar atraso toda segunda-feira
-- por sábado ter vendido mais.
--
-- Como toda tabela de espelho (doc 05 §4), não há FK contra app_tenants: os ids vêm do ERP e a
-- purga do offboarding apaga por tenant_id. O isolamento é da RLS estrita aplicada no fim.

CREATE TABLE "erp_previsao_vendas" (
  "tenant_id"      UUID NOT NULL,
  "filial_erp_id"  INTEGER NOT NULL,
  "competencia"    DATE NOT NULL,
  "previsao_venda" DECIMAL(14, 4) NOT NULL,
  "previsao_lucro" DECIMAL(14, 4),
  "dias_uteis"     INTEGER,
  "synced_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "erp_previsao_vendas_pkey" PRIMARY KEY ("tenant_id", "filial_erp_id", "competencia")
);

CREATE INDEX "erp_previsao_vendas_tenant_id_competencia_idx"
  ON "erp_previsao_vendas" ("tenant_id", "competencia");

CREATE TABLE "erp_previsao_vendas_diaria" (
  "tenant_id"      UUID NOT NULL,
  "filial_erp_id"  INTEGER NOT NULL,
  "data"           DATE NOT NULL,
  "previsao_venda" DECIMAL(14, 4) NOT NULL,
  "synced_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "erp_previsao_vendas_diaria_pkey" PRIMARY KEY ("tenant_id", "filial_erp_id", "data")
);

CREATE INDEX "erp_previsao_vendas_diaria_tenant_id_data_idx"
  ON "erp_previsao_vendas_diaria" ("tenant_id", "data");

-- ---------------------------------------------------------------------------
-- RLS estrita e grants (doc 08 §6.3). O gate `pnpm db:rls-check` reprova qualquer tabela com
-- tenant_id que escape daqui — é ele que impede uma tabela nova de nascer sem isolamento.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  tabela text;
  tabelas text[] := ARRAY['erp_previsao_vendas', 'erp_previsao_vendas_diaria'];
BEGIN
  FOREACH tabela IN ARRAY tabelas LOOP
    CALL app_enable_tenant_rls(tabela);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', tabela);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
      EXECUTE format('GRANT SELECT ON %I TO app_readonly', tabela);
    END IF;
  END LOOP;
END;
$$;
