-- CreateEnum
CREATE TYPE "alert_type" AS ENUM ('ruptura_curva_a', 'estoque_negativo', 'divergencia_fechamento', 'queda_de_venda', 'integracao_parada', 'vencimento_proximo', 'perda_anormal', 'meta_em_risco', 'conta_a_vencer', 'cartao_nao_conciliado');

-- CreateEnum
CREATE TYPE "alert_severity" AS ENUM ('critica', 'alta', 'media', 'baixa');

-- CreateEnum
CREATE TYPE "alert_event_status" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('pending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "app_alert_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "alert_type" NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "canal_email" BOOLEAN NOT NULL DEFAULT true,
    "audiencia" VARCHAR(20) NOT NULL DEFAULT 'operacao',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "app_alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_alert_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "filial_erp_id" INTEGER,
    "dedupe_key" VARCHAR(180) NOT NULL,
    "payload" JSONB NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "status" "alert_event_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acked_by" UUID,
    "acked_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "app_alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "alert_event_id" UUID,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'email',
    "status" "notification_status" NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMPTZ(6),
    "error" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_alert_rules_tenant_id_enabled_idx" ON "app_alert_rules"("tenant_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "app_alert_rules_tenant_id_type_key" ON "app_alert_rules"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "app_alert_events_tenant_id_status_created_at_idx" ON "app_alert_events"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "app_alert_events_tenant_id_rule_id_dedupe_key_key" ON "app_alert_events"("tenant_id", "rule_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "app_notifications_tenant_id_status_idx" ON "app_notifications"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "app_notifications_tenant_id_alert_event_id_idx" ON "app_notifications"("tenant_id", "alert_event_id");

-- AddForeignKey
ALTER TABLE "app_alert_events" ADD CONSTRAINT "app_alert_events_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "app_alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS e privilégios das tabelas de alerta (doc 08 §3 / doc 24 §7 passo 3).
--
-- Template estrito: evento de alerta carrega o retrato de um problema de uma rede (contagens,
-- filiais, valores). Sem `app.tenant_id` fixado, a consulta falha — é o mesmo contrato das
-- demais tabelas de tenant, e é o que o gate `pnpm db:rls-check` confere.
--
-- O papel de BI (`app_readonly`) não entra aqui: alerta é estado operacional do produto, não
-- dado de negócio para análise externa.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  tabela text;
  tabelas text[] := ARRAY['app_alert_rules', 'app_alert_events', 'app_notifications'];
BEGIN
  FOREACH tabela IN ARRAY tabelas LOOP
    CALL app_enable_tenant_rls(tabela);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', tabela);
    END IF;
  END LOOP;
END;
$$;
