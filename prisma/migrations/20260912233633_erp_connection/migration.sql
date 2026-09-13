-- CreateEnum
CREATE TYPE "erp_tls_mode" AS ENUM ('https', 'vpn');

-- CreateEnum
CREATE TYPE "erp_connection_status" AS ENUM ('pending', 'ok', 'error');

-- CreateEnum
CREATE TYPE "erp_auth_header_mode" AS ENUM ('raw', 'bearer');

-- CreateTable
CREATE TABLE "app_erp_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "base_url" VARCHAR(255) NOT NULL,
    "is_sg_cloud" BOOLEAN NOT NULL DEFAULT false,
    "auth_path_override" VARCHAR(255),
    "tls_mode" "erp_tls_mode" NOT NULL DEFAULT 'https',
    "username" VARCHAR(120) NOT NULL,
    "secret_ciphertext" BYTEA NOT NULL,
    "secret_key_version" INTEGER NOT NULL,
    "auth_header_mode" "erp_auth_header_mode" NOT NULL DEFAULT 'raw',
    "max_rps" INTEGER NOT NULL DEFAULT 4,
    "sync_window_start" VARCHAR(5),
    "sync_window_end" VARCHAR(5),
    "status" "erp_connection_status" NOT NULL DEFAULT 'pending',
    "last_error" VARCHAR(300),
    "last_token_expires_at" TIMESTAMPTZ(6),
    "last_health_at" TIMESTAMPTZ(6),
    "health_payload" JSONB,
    "routes_granted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "routes_checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "app_erp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_erp_connections_tenant_id_key" ON "app_erp_connections"("tenant_id");

-- CreateIndex
CREATE INDEX "app_erp_connections_status_idx" ON "app_erp_connections"("status");

-- AddForeignKey
ALTER TABLE "app_erp_connections" ADD CONSTRAINT "app_erp_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "app_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RLS: conexão é dado de tenant (template estrito)
CALL app_enable_tenant_rls('app_erp_connections');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON app_erp_connections TO app_rw;
  END IF;
  -- O papel de BI NÃO recebe acesso: a tabela guarda credencial cifrada (doc 09 §1 "Banco").
END;
$$;
