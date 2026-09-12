-- AlterTable
ALTER TABLE "app_sessions" ADD COLUMN     "mfa_verified_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "app_totp_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_totp_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_invites" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" "membership_role" NOT NULL,
    "filiais_allowed" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "token_hash" VARCHAR(64) NOT NULL,
    "invited_by" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_totp_recovery_codes_user_id_idx" ON "app_totp_recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_totp_recovery_codes_user_id_code_hash_key" ON "app_totp_recovery_codes"("user_id", "code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "app_invites_token_hash_key" ON "app_invites"("token_hash");

-- CreateIndex
CREATE INDEX "app_invites_tenant_id_email_idx" ON "app_invites"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "app_invites_expires_at_idx" ON "app_invites"("expires_at");

-- AddForeignKey
ALTER TABLE "app_totp_recovery_codes" ADD CONSTRAINT "app_totp_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_invites" ADD CONSTRAINT "app_invites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "app_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_invites" ADD CONSTRAINT "app_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Isolamento e privilégios das novas tabelas (doc 08 §3).
-- ============================================================================

-- app_invites carrega tenant_id, mas é lida pelo token ANTES de haver tenant no contexto
-- (a pessoa convidada ainda não é membro de nada) — por isso o template de identidade.
CALL app_enable_identity_rls('app_invites');

-- app_totp_recovery_codes não tem tenant_id: é dado de identidade, como app_users.
-- Fica fora de RLS e só é acessível pelo serviço de MFA.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON app_invites, app_totp_recovery_codes TO app_rw;
  END IF;
END;
$$;
