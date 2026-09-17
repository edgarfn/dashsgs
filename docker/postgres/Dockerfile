# Postgres com WAL-G embutido (doc 20 §2).
#
# Por que na imagem do banco e não num sidecar: `archive_command` roda DENTRO do Postgres, com
# acesso ao `pg_wal`. WAL-G num container ao lado só conseguiria fazer base backup — e base
# backup sem WAL contínuo dá um RPO de 24 h, não de 1 h como promete o doc 20 §1.
#
# Por que `bookworm` e não `alpine`: os binários oficiais do WAL-G são ligados à glibc e não
# rodam em musl. A alternativa seria compilar WAL-G do fonte a cada build — mais peças para
# quebrar no dia do restore, que é o pior dia possível para descobrir um build quebrado.
#
# ATENÇÃO na troca de base: glibc e musl ordenam texto de forma diferente. Trocar a imagem de um
# banco que JÁ TEM DADOS exige `REINDEX DATABASE` — índice de texto criado sob uma collation e
# lido sob outra devolve resultado errado sem nunca acusar erro. Em instalação nova, não há o
# que reindexar. (Runbook 22 §14.)

FROM postgres:17-bookworm

# Versão fixa: o WAL-G lê e escreve formato próprio, e "a última" mudando sozinha entre o backup
# e o restore é a forma mais cara de descobrir uma incompatibilidade.
ARG WALG_VERSION=v3.0.5
ARG WALG_ARCH=amd64

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    curl -fsSL -o /tmp/wal-g.tar.gz \
      "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-ubuntu-20.04-${WALG_ARCH}.tar.gz"; \
    tar -xzf /tmp/wal-g.tar.gz -C /tmp; \
    mv "/tmp/wal-g-pg-ubuntu-20.04-${WALG_ARCH}" /usr/local/bin/wal-g; \
    chmod 0755 /usr/local/bin/wal-g; \
    rm -f /tmp/wal-g.tar.gz; \
    apt-get purge -y curl; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*; \
    wal-g --version

# Os scripts de backup e de teste de restauração acompanham a imagem: quem restaura em uma VM
# nova, no meio de um desastre, precisa do procedimento junto com o binário — não num repositório
# que talvez não esteja acessível naquela hora.
COPY scripts/backup/ /opt/dashsgs/backup/
RUN chmod +x /opt/dashsgs/backup/*.sh

# Diretório do textfile collector criado AQUI, e já do usuário `postgres`. Volume nomeado que
# não existe na imagem nasce root:root, e o container de backup roda sem privilégio — a métrica
# de sucesso não seria publicada e o alerta de "backup falhou" dispararia sobre um backup que
# deu certo. Docker copia dono e permissão da imagem ao inicializar o volume.
RUN mkdir -p /textfile && chown postgres:postgres /textfile
