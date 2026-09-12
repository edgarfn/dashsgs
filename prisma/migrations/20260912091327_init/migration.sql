-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('invited', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('owner', 'admin', 'manager', 'analyst', 'viewer', 'auditor');

-- CreateEnum
CREATE TYPE "audit_result" AS ENUM ('success', 'denied', 'error');

-- CreateTable
CREATE TABLE "app_tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'active',
    "plan" VARCHAR(40) NOT NULL DEFAULT 'beta',
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'America/Sao_Paulo',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "app_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "password_hash" VARCHAR(255),
    "status" "user_status" NOT NULL DEFAULT 'invited',
    "totp_secret_ciphertext" BYTEA,
    "totp_key_version" INTEGER,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL,
    "filiais_allowed" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "app_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_sessions" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID,
    "ip" INET,
    "user_agent" VARCHAR(255),
    "mfa_passed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "app_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_password_resets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "app_password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_audit_log" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "session_id" VARCHAR(64),
    "action" VARCHAR(80) NOT NULL,
    "resource_type" VARCHAR(60) NOT NULL,
    "resource_id" VARCHAR(120),
    "result" "audit_result" NOT NULL,
    "ip" INET,
    "user_agent" VARCHAR(255),
    "changes" JSONB,
    "prev_hash" BYTEA,
    "entry_hash" BYTEA,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_tenants_slug_key" ON "app_tenants"("slug");

-- CreateIndex
CREATE INDEX "app_tenants_status_idx" ON "app_tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "app_users_email_key" ON "app_users"("email");

-- CreateIndex
CREATE INDEX "app_memberships_tenant_id_idx" ON "app_memberships"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_memberships_user_id_tenant_id_key" ON "app_memberships"("user_id", "tenant_id");

-- CreateIndex
CREATE INDEX "app_sessions_user_id_idx" ON "app_sessions"("user_id");

-- CreateIndex
CREATE INDEX "app_sessions_expires_at_idx" ON "app_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "app_password_resets_user_id_idx" ON "app_password_resets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_password_resets_token_hash_key" ON "app_password_resets"("token_hash");

-- CreateIndex
CREATE INDEX "app_audit_log_tenant_id_created_at_idx" ON "app_audit_log"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "app_audit_log_user_id_created_at_idx" ON "app_audit_log"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "app_memberships" ADD CONSTRAINT "app_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_memberships" ADD CONSTRAINT "app_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "app_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "app_tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_password_resets" ADD CONSTRAINT "app_password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- A partir daqui: objetos que o Prisma não modela (doc 08 §3, doc 05 §6).
-- Escrito à mão e revisado — é a camada que segura o isolamento no BANCO, não na aplicação.
-- ============================================================================

-- ---------------------------------------------------------------- contexto de tenant
-- A aplicação abre transação e executa `SET LOCAL app.tenant_id = '<uuid>'` (PrismaService.withTenant).

/** Tenant do contexto atual, ou NULL quando nenhum foi fixado (fluxos de identidade). */
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

/** Idem, porém exige o contexto: consulta sem tenant fixado FALHA em vez de vazar. */
CREATE OR REPLACE FUNCTION app_required_tenant_id() RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  v_tenant := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'app.tenant_id não definido nesta transação (isolamento — doc 08 §3)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_tenant;
END;
$$;

/** Usuário autenticado do contexto atual (usado nas tabelas de identidade). */
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------- templates de RLS
-- Toda tabela com `tenant_id` criada daqui em diante DEVE chamar um destes dois templates na
-- própria migração. O CI tem gate de introspecção (pg_policies) que falha se alguém esquecer.

/**
 * Template ESTRITO — dados de tenant (erp_*, agg_*, sync_*, app_alert_*...).
 * Sem contexto de tenant a consulta nem sequer roda: `app_required_tenant_id()` levanta erro.
 */
CREATE OR REPLACE PROCEDURE app_enable_tenant_rls(p_table regclass)
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (tenant_id = app_required_tenant_id()) '
    'WITH CHECK (tenant_id = app_required_tenant_id())', p_table);
END;
$$;

/**
 * Template de IDENTIDADE — tabelas que o fluxo de login precisa ler ANTES de existir um tenant
 * escolhido (memberships, sessões, auditoria de plataforma).
 * Com contexto fixado, o isolamento é o mesmo do template estrito; sem contexto, a leitura é
 * permitida apenas para os serviços de identidade, que não expõem dados de negócio.
 */
CREATE OR REPLACE PROCEDURE app_enable_identity_rls(p_table regclass)
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s '
    'USING (app_current_tenant_id() IS NULL OR tenant_id IS NULL OR tenant_id = app_current_tenant_id()) '
    'WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id IS NULL OR tenant_id = app_current_tenant_id())',
    p_table);
END;
$$;

CALL app_enable_identity_rls('app_memberships');
CALL app_enable_identity_rls('app_sessions');
CALL app_enable_identity_rls('app_audit_log');

-- ---------------------------------------------------------------- auditoria append-only
-- doc 05 §6: a trilha não pode ser alterada nem apagada — nem por engano, nem por invasor com
-- as credenciais da aplicação. Defesa dupla: privilégio revogado + trigger.

CREATE OR REPLACE FUNCTION app_audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'app_audit_log é append-only (doc 05 §6): % bloqueado', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER app_audit_log_no_update
  BEFORE UPDATE ON app_audit_log
  FOR EACH ROW EXECUTE FUNCTION app_audit_log_immutable();

CREATE TRIGGER app_audit_log_no_delete
  BEFORE DELETE ON app_audit_log
  FOR EACH ROW EXECUTE FUNCTION app_audit_log_immutable();

-- ---------------------------------------------------------------- privilégios
-- O papel da aplicação recebe o mínimo necessário; migrações continuam com app_migrator.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      app_tenants, app_users, app_memberships, app_sessions, app_password_resets TO app_rw;
    GRANT SELECT, INSERT ON app_audit_log TO app_rw;
    REVOKE UPDATE, DELETE ON app_audit_log FROM app_rw;
    GRANT USAGE, SELECT ON SEQUENCE app_audit_log_id_seq TO app_rw;
    GRANT EXECUTE ON FUNCTION app_current_tenant_id(), app_required_tenant_id(),
      app_current_user_id() TO app_rw;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON app_tenants, app_memberships, app_audit_log TO app_readonly;
  END IF;
END;
$$;
