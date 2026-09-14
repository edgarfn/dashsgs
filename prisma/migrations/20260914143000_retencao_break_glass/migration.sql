-- Fase 9 (E6-04 + E9-03): retenção com purga, offboarding físico e break-glass auditado.
-- Docs 08 §5, 10 §2, 07 §4.5 e runbook 22 §11.

-- AlterTable
ALTER TABLE "app_tenants" ADD COLUMN     "purged_at" TIMESTAMPTZ(6),
ADD COLUMN     "retention_sales_months" INTEGER NOT NULL DEFAULT 26;

-- CreateTable
CREATE TABLE "app_break_glass_grants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "ticket" VARCHAR(60) NOT NULL,
    "justification" VARCHAR(300) NOT NULL,
    "role" "membership_role" NOT NULL DEFAULT 'viewer',
    "ttl_minutes" INTEGER NOT NULL,
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,

    CONSTRAINT "app_break_glass_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_break_glass_grants_tenant_id_created_at_idx" ON "app_break_glass_grants"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "app_break_glass_grants_requested_by_expires_at_idx" ON "app_break_glass_grants"("requested_by", "expires_at");

-- CreateIndex
CREATE INDEX "app_audit_log_created_at_idx" ON "app_audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "app_break_glass_grants" ADD CONSTRAINT "app_break_glass_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "app_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_break_glass_grants" ADD CONSTRAINT "app_break_glass_grants_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_break_glass_grants" ADD CONSTRAINT "app_break_glass_grants_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------- RLS do break-glass
-- Template de IDENTIDADE: a concessão é lida durante a resolução da sessão, antes de existir um
-- tenant escolhido — é ela, aliás, que cria o vínculo temporário.
CALL app_enable_identity_rls('app_break_glass_grants');

-- ---------------------------------------------------------------- purga da auditoria (E6-04)
-- doc 10 §2: a trilha vive 5 anos. Até aqui nenhuma linha podia sair — nem por engano, nem por
-- invasor com a credencial da aplicação —, e é justamente essa propriedade que dá valor à trilha.
--
-- A retenção abre UMA exceção, e ela mora no banco, não no código: a trigger passa a aceitar
-- DELETE apenas quando (a) o sinalizador `app.audit_purge` está ligado na transação corrente e
-- (b) a linha já passou dos 5 anos. Quem liga o sinalizador é a função abaixo, e só ela. A
-- aplicação continua sem privilégio de DELETE na tabela: mesmo que alguém escreva o DELETE, o
-- Postgres recusa antes da trigger.
CREATE OR REPLACE FUNCTION app_audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.audit_purge', true) = 'on'
     AND OLD.created_at < now() - INTERVAL '5 years' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'app_audit_log é append-only (doc 05 §6): % bloqueado', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- SECURITY DEFINER porque o papel da aplicação não tem (e não deve ter) DELETE na trilha.
-- O prazo é constante aqui dentro de propósito: se viesse por parâmetro, bastaria uma chamada
-- errada da aplicação para apagar a auditoria de ontem.
CREATE OR REPLACE FUNCTION app_purge_audit_log(p_limite integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_removidos integer;
BEGIN
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 50000 THEN
    RAISE EXCEPTION 'limite fora da faixa (1..50000): %', p_limite;
  END IF;

  PERFORM set_config('app.audit_purge', 'on', true);

  WITH vencidos AS (
    SELECT id
      FROM app_audit_log
     WHERE created_at < now() - INTERVAL '5 years'
     ORDER BY created_at
     LIMIT p_limite
  )
  DELETE FROM app_audit_log a USING vencidos v WHERE a.id = v.id;

  GET DIAGNOSTICS v_removidos = ROW_COUNT;
  PERFORM set_config('app.audit_purge', 'off', true);

  RETURN v_removidos;
END;
$$;

-- ---------------------------------------------------------------- privilégios
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON app_break_glass_grants TO app_rw;
    GRANT EXECUTE ON FUNCTION app_purge_audit_log(integer) TO app_rw;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON app_break_glass_grants TO app_readonly;
  END IF;
END;
$$;
