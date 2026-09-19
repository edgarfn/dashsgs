-- Papéis do banco (doc 08 §3 / doc 09 §1 "Banco").
-- Executado uma única vez na criação do volume do Postgres de DESENVOLVIMENTO.
-- Em staging/produção estes mesmos papéis são criados por ./scripts/provision-roles.sh, com
-- senhas do cofre em vez da fixa abaixo — runbook 22 §0 / doc 19 §9.5.4.

-- Papel da aplicação: NUNCA com BYPASSRLS (a RLS é a última linha de defesa).
CREATE ROLE app_rw LOGIN PASSWORD 'dev_only_password' NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOBYPASSRLS;

-- Papel de migração: cria/altera objetos; também sem BYPASSRLS.
CREATE ROLE app_migrator LOGIN PASSWORD 'dev_only_password' NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOBYPASSRLS;

-- Papel de leitura para BI interno (sem acesso a colunas sensíveis — views virão no doc 10).
CREATE ROLE app_readonly LOGIN PASSWORD 'dev_only_password' NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOBYPASSRLS;

ALTER SCHEMA public OWNER TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_rw, app_readonly;
GRANT CREATE ON SCHEMA public TO app_migrator;

-- Tudo que o migrator criar fica acessível ao papel da aplicação (e somente leitura ao BI).
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO app_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_rw;

-- Banco sombra usado pelo Prisma para detectar drift (nunca existe em produção).
CREATE DATABASE dashsgs_shadow OWNER app_migrator;

-- Papel de observabilidade (doc 18 §2): o postgres_exporter entra por aqui.
-- `pg_monitor` dá acesso às visões de estatística e NADA de dado de aplicação — um exporter
-- comprometido não deve ser um caminho para a tabela de vendas de um cliente.
CREATE ROLE app_monitor LOGIN PASSWORD 'dev_only_password' NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOBYPASSRLS;
GRANT pg_monitor TO app_monitor;
