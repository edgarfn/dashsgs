-- AlterTable
ALTER TABLE "app_tenants" ADD COLUMN     "suspended_at" TIMESTAMPTZ(6),
ADD COLUMN     "suspension_reason" VARCHAR(200);

-- AlterTable
ALTER TABLE "app_users" ADD COLUMN     "platform_admin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "erp_filiais" (
    "tenant_id" UUID NOT NULL,
    "erp_id" INTEGER NOT NULL,
    "razao_social" VARCHAR(160) NOT NULL,
    "nome_fantasia" VARCHAR(160),
    "cnpj" VARCHAR(14),
    "municipio_erp_id" INTEGER,
    "uf" CHAR(2),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_filiais_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateIndex
CREATE INDEX "erp_filiais_tenant_id_synced_at_idx" ON "erp_filiais"("tenant_id", "synced_at");

-- AddForeignKey
ALTER TABLE "erp_filiais" ADD CONSTRAINT "erp_filiais_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "app_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Isolamento por tenant (doc 08 §3) — a camada que o Prisma não modela.
-- ============================================================================

-- erp_filiais é dado de TENANT: usa o template ESTRITO. Consulta sem 'app.tenant_id' fixado
-- levanta erro em vez de devolver linha alguma — falha barulhenta é melhor que vazamento silencioso.
CALL app_enable_tenant_rls('erp_filiais');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON erp_filiais TO app_rw;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON erp_filiais TO app_readonly;
  END IF;
END;
$$;

-- ---------------------------------------------------------------- introspecção de RLS
/**
 * Lista tabelas que têm coluna 'tenant_id' e NÃO estão devidamente protegidas: sem RLS, sem
 * FORCE (que vale até para o dono) ou sem política.
 *
 * É o gate do doc 08 §6.3: o CI falha se esta função devolver qualquer linha. Esquecer a RLS de
 * uma tabela nova passa a ser um erro de build, não uma descoberta em auditoria.
 */
CREATE OR REPLACE FUNCTION app_rls_gaps()
RETURNS TABLE (table_name text, rls_enabled boolean, rls_forced boolean, policy_count integer)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT
    c.relname::text,
    c.relrowsecurity,
    c.relforcerowsecurity,
    (
      SELECT count(*)::int
      FROM pg_policy p
      WHERE p.polrelid = c.oid
    )
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = c.oid
        AND a.attname = 'tenant_id'
        AND NOT a.attisdropped
    )
    AND (
      NOT c.relrowsecurity
      OR NOT c.relforcerowsecurity
      OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
    );
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION app_rls_gaps() TO app_rw;
  END IF;
END;
$$;
