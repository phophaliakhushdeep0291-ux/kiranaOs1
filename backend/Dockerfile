FROM node:22-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl --fail --silent --show-error https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*

# Scheduled backups and restore drills run inside this same image. Debian's
# default client can be older than our PostgreSQL 16 server and refuse a dump.
# Execute every required tool during the build so host-installed CI tools cannot
# hide a missing binary or shared library in the deployed container.
RUN pg_dump --version && pg_restore --version && psql --version

COPY package*.json ./
# NODE_ENV=production above makes npm omit devDependencies by default, but the
# next step needs the prisma CLI, which is one. --include=dev keeps it; the
# earlier --omit=dev=false was not valid npm syntax (npm warned "invalid config"
# and only kept dev by accident of how the bad value was discarded).
RUN npm ci --include=dev

COPY prisma ./prisma
COPY prisma-postgres ./prisma-postgres
RUN npm run prisma:generate:postgres

COPY src ./src
COPY scripts ./scripts
COPY docs ./docs
COPY contracts ./contracts
COPY public ./public
COPY .env.example ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# DIRECT_DATABASE_URL falls back to DATABASE_URL so deployments without a
# PgBouncer/pooler in front keep working unchanged. With a pooler: point
# DATABASE_URL at the pooled port (?pgbouncer=true) and DIRECT_DATABASE_URL
# at the raw Postgres port for migrations.
# The supervised runtime starts the API and, when queues are enabled, the worker
# as separate OS processes. If either dies, the container exits so Railway can
# restart a complete pair rather than leaving queued work stranded.
CMD ["sh", "-c", "export DIRECT_DATABASE_URL=\"${DIRECT_DATABASE_URL:-$DATABASE_URL}\" && npm run deploy:migrate:postgres && npm run start:runtime"]
