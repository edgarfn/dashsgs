-- CreateTable
CREATE TABLE "erp_contas_pagar" (
    "tenant_id" UUID NOT NULL,
    "erp_id" INTEGER NOT NULL,
    "filial_erp_id" INTEGER,
    "fornecedor_erp_id" INTEGER,
    "documento" VARCHAR(40),
    "data_emissao" DATE,
    "valor_total" DECIMAL(14,4),
    "observacao" VARCHAR(300),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_contas_pagar_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_conta_pagar_parcelas" (
    "tenant_id" UUID NOT NULL,
    "conta_erp_id" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL,
    "data_vencimento" DATE,
    "data_pagamento" DATE,
    "valor_documento" DECIMAL(14,4),
    "valor_pago" DECIMAL(14,4),
    "saldo" DECIMAL(14,4),
    "paga" BOOLEAN NOT NULL DEFAULT false,
    "tipo_lancamento" VARCHAR(40),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_conta_pagar_parcelas_pkey" PRIMARY KEY ("tenant_id","conta_erp_id","ordem")
);

-- CreateTable
CREATE TABLE "erp_contas_receber" (
    "tenant_id" UUID NOT NULL,
    "erp_id" INTEGER NOT NULL,
    "filial_erp_id" INTEGER,
    "cliente_erp_id" INTEGER,
    "documento" VARCHAR(40),
    "data_emissao" DATE,
    "valor_total" DECIMAL(14,4),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_contas_receber_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_conta_receber_parcelas" (
    "tenant_id" UUID NOT NULL,
    "conta_erp_id" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL,
    "data_vencimento" DATE,
    "data_pagamento" DATE,
    "valor_documento" DECIMAL(14,4),
    "valor_pago" DECIMAL(14,4),
    "saldo" DECIMAL(14,4),
    "juros" DECIMAL(14,4),
    "desconto" DECIMAL(14,4),
    "paga" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_conta_receber_parcelas_pkey" PRIMARY KEY ("tenant_id","conta_erp_id","ordem")
);

-- CreateTable
CREATE TABLE "erp_tipos_despesa" (
    "tenant_id" UUID NOT NULL,
    "erp_id" VARCHAR(20) NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "classificacao" VARCHAR(40),
    "tipo_custo" VARCHAR(40),
    "dep1_erp_id" VARCHAR(20),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_tipos_despesa_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_despesas" (
    "tenant_id" UUID NOT NULL,
    "filial_erp_id" INTEGER NOT NULL,
    "data_despesa" DATE NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "tipo_despesa_erp_id" VARCHAR(20),
    "fornecedor_erp_id" INTEGER,
    "data_emissao" DATE,
    "valor" DECIMAL(14,4) NOT NULL,
    "classificacao" VARCHAR(40),
    "usuario_erp" VARCHAR(60),
    "observacao" VARCHAR(300),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_despesas_pkey" PRIMARY KEY ("tenant_id","filial_erp_id","data_despesa","sequencia")
);

-- CreateTable
CREATE TABLE "erp_cartao_vendas" (
    "tenant_id" UUID NOT NULL,
    "chave_venda" VARCHAR(60) NOT NULL,
    "filial_erp_id" INTEGER NOT NULL,
    "nsu" VARCHAR(40),
    "data_venda" DATE,
    "data_vencimento" DATE,
    "valor_bruto" DECIMAL(14,4) NOT NULL,
    "taxa_pct" DECIMAL(7,4),
    "tipo_venda" VARCHAR(40),
    "forma_pagamento" VARCHAR(40),
    "bandeira" VARCHAR(60),
    "adquirente" VARCHAR(60),
    "parcela" INTEGER,
    "baixada" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_cartao_vendas_pkey" PRIMARY KEY ("tenant_id","chave_venda")
);

-- CreateTable
CREATE TABLE "erp_pedidos_compra" (
    "tenant_id" UUID NOT NULL,
    "erp_id" INTEGER NOT NULL,
    "filial_erp_id" INTEGER,
    "fornecedor_erp_id" INTEGER,
    "comprador_erp_id" INTEGER,
    "data_pedido" DATE,
    "data_previsao" DATE,
    "data_atendimento" DATE,
    "situacao" VARCHAR(30),
    "valor_total" DECIMAL(14,4),
    "valor_frete" DECIMAL(14,4),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_pedidos_compra_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateTable
CREATE TABLE "erp_notas_entrada" (
    "tenant_id" UUID NOT NULL,
    "erp_id" INTEGER NOT NULL,
    "filial_erp_id" INTEGER,
    "fornecedor_erp_id" INTEGER,
    "numero" VARCHAR(20),
    "serie" VARCHAR(10),
    "data_emissao" DATE,
    "data_entrada" DATE,
    "valor_total" DECIMAL(14,4),
    "situacao" VARCHAR(30),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_notas_entrada_pkey" PRIMARY KEY ("tenant_id","erp_id")
);

-- CreateIndex
CREATE INDEX "erp_contas_pagar_tenant_id_data_emissao_idx" ON "erp_contas_pagar"("tenant_id", "data_emissao");

-- CreateIndex
CREATE INDEX "erp_conta_pagar_parcelas_tenant_id_paga_data_vencimento_idx" ON "erp_conta_pagar_parcelas"("tenant_id", "paga", "data_vencimento");

-- CreateIndex
CREATE INDEX "erp_contas_receber_tenant_id_data_emissao_idx" ON "erp_contas_receber"("tenant_id", "data_emissao");

-- CreateIndex
CREATE INDEX "erp_conta_receber_parcelas_tenant_id_paga_data_vencimento_idx" ON "erp_conta_receber_parcelas"("tenant_id", "paga", "data_vencimento");

-- CreateIndex
CREATE INDEX "erp_despesas_tenant_id_data_despesa_idx" ON "erp_despesas"("tenant_id", "data_despesa");

-- CreateIndex
CREATE INDEX "erp_despesas_tenant_id_tipo_despesa_erp_id_idx" ON "erp_despesas"("tenant_id", "tipo_despesa_erp_id");

-- CreateIndex
CREATE INDEX "erp_cartao_vendas_tenant_id_data_venda_idx" ON "erp_cartao_vendas"("tenant_id", "data_venda");

-- CreateIndex
CREATE INDEX "erp_cartao_vendas_tenant_id_baixada_data_venda_idx" ON "erp_cartao_vendas"("tenant_id", "baixada", "data_venda");

-- CreateIndex
CREATE INDEX "erp_pedidos_compra_tenant_id_situacao_data_pedido_idx" ON "erp_pedidos_compra"("tenant_id", "situacao", "data_pedido");

-- CreateIndex
CREATE INDEX "erp_pedidos_compra_tenant_id_data_pedido_idx" ON "erp_pedidos_compra"("tenant_id", "data_pedido");

-- CreateIndex
CREATE INDEX "erp_notas_entrada_tenant_id_data_entrada_idx" ON "erp_notas_entrada"("tenant_id", "data_entrada");

-- AddForeignKey
ALTER TABLE "erp_conta_pagar_parcelas" ADD CONSTRAINT "erp_conta_pagar_parcelas_tenant_id_conta_erp_id_fkey" FOREIGN KEY ("tenant_id", "conta_erp_id") REFERENCES "erp_contas_pagar"("tenant_id", "erp_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_conta_receber_parcelas" ADD CONSTRAINT "erp_conta_receber_parcelas_tenant_id_conta_erp_id_fkey" FOREIGN KEY ("tenant_id", "conta_erp_id") REFERENCES "erp_contas_receber"("tenant_id", "erp_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS e privilégios do espelho financeiro e de compras (doc 08 §3 / doc 24 §7 passo 3).
--
-- Template estrito, como todo dado de tenant. Estas tabelas são das mais sensíveis do produto:
-- contas a pagar, taxas de cartão e despesas dizem a margem e a saúde de caixa de uma rede
-- (doc 02, classificação FINANCIAL). O papel de BI (`app_readonly`) lê, porque é exatamente o
-- material das análises que o cliente vai querer cruzar.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  tabela text;
  tabelas text[] := ARRAY[
    'erp_contas_pagar', 'erp_conta_pagar_parcelas',
    'erp_contas_receber', 'erp_conta_receber_parcelas',
    'erp_tipos_despesa', 'erp_despesas',
    'erp_cartao_vendas',
    'erp_pedidos_compra', 'erp_notas_entrada'
  ];
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
