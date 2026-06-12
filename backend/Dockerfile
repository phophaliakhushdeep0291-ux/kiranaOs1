FROM node:20-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev=false

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
CMD ["sh", "-c", "export DIRECT_DATABASE_URL=\"${DIRECT_DATABASE_URL:-$DATABASE_URL}\" && npm run deploy:migrate:postgres && npm start"]
