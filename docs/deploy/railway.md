# Railway deployment

The Railway-specific half of [`cafe-launch.md`](./cafe-launch.md). That document
is the sequence and the gates; this one is what to click and what Railway will
do to you if you do not.

## Services

One project, five services:

| Service | Source | Root directory | Notes |
|---|---|---|---|
| `postgres` | Railway PostgreSQL | — | The only thing holding data |
| `postgres-drill` | Railway PostgreSQL | — | Empty. Exists only to be destroyed by restore drills |
| `backend` | this repo | `backend` | Dockerfile detected automatically |
| `frontend` | this repo | `frontend` | Static build, served as a site |
| `dinein` | `dinein` repo | repo root | Dockerfile detected automatically |
| `backup` | this repo | `backend` | Scheduled service, no public domain |

Both repos are monorepo-ish, so **set the root directory on each service** or
Railway builds the wrong thing.

The second database costs money and is not optional. A restore drill needs
somewhere to restore *to*, and it must never be the live one — the drill drops
and recreates the target's schema. `postgres-drill` is what makes step 7 of the
launch runbook possible at all.

---

## Migrations run themselves

`backend/Dockerfile` ends with:

```
prisma:deploy:postgres && prisma:generate:postgres && verify-product-schema && npm start
```

So on Railway **every deploy migrates before the API starts**. You do not run
`deploy:migrate` by hand; the manual steps in the launch runbook are for
non-Docker hosts.

Two consequences:

- **A failed migration fails the deploy.** That is correct — the old container
  keeps serving until the new one is healthy. Do not "fix" it by moving
  migrations out of the CMD.
- **Take a backup before deploying a release that migrates.** Railway will
  happily roll the container back; it will not roll the schema back.

`DIRECT_DATABASE_URL` falls back to `DATABASE_URL` in the CMD, so leave it unset
unless you put a pooler in front.

---

## Variables

Use Railway's references rather than pasting values, so a rotated password
reaches every service:

```ini
# backend
DATABASE_URL=${{postgres.DATABASE_URL}}
NODE_ENV=production
JWT_SECRET=<generated, 32+ chars>
METRICS_REQUIRE_TOKEN=true
METRICS_TOKEN=<generated, 24+ chars>
ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION=false
STOREFRONT_WRITE_LIMIT_MAX=1000
STOREFRONT_READ_LIMIT_MAX=20000
ALLOWED_ORIGINS=https://<frontend-domain>,https://<dinein-domain>
```

```ini
# dinein
NODE_ENV=production
ORDERING_GATEWAY=http
KIRANAOS_BASE_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}}
KIRANAOS_SHOP_MAP={"my-cafe":"<kiranaos-shop-id>"}
KIRANAOS_TIMEOUT_MS=8000
```

### The ordering trap

`ALLOWED_ORIGINS` must contain the frontend and DineIn domains, and
`production-preflight.js` rejects `localhost`, `http://` and `*`. But Railway
does not mint a domain until a service has deployed once.

So the first pass is necessarily two-phase:

1. Deploy all three with `ALLOWED_ORIGINS` set to a placeholder HTTPS value.
2. Generate the public domains.
3. Set the real `ALLOWED_ORIGINS`, redeploy `backend`.

Do not skip step 3 because the app appears to work — you will have shipped a
backend that refuses the till's browser requests, and it will look like a
network fault.

### Private networking

`KIRANAOS_BASE_URL` can use `backend.railway.internal` instead of the public
domain, which keeps guest traffic off the public edge. **Confirm this works
before relying on it**: Railway's private network is IPv6-only, so the backend
has to be listening on `::` rather than `0.0.0.0` for it to resolve. If a
private URL 502s, that is the reason — use the public domain and move on. It is
one café's traffic.

---

## Health checks

| Service | Path |
|---|---|
| `backend` | `/health/ready` — checks the database, not just the process |
| `dinein` | `/api/health/ready` |

Both Dockerfiles already declare these; set the same path in Railway's health
check field so a failed deploy is caught before it takes traffic. `/api/health`
and `/health` on the backend are liveness only — they answer while the database
is unreachable, so do not point the deploy gate at them.

---

## Backups: what actually works here

**Correcting the launch runbook.** It said to set `DATABASE_BACKUP_ENABLED=true`
while leaving `QUEUES_ENABLED` off. Those contradict, and the result is worse
than no backup because it looks like one.

`DATABASE_BACKUP_ENABLED` schedules a **BullMQ** job. `registerMaintenanceSchedulers()`
returns `JOB_QUEUE_UNAVAILABLE` and does nothing without Redis, and the code says
in as many words that the schedule "is only meaningful once object storage is
configured". At café scale that is three extra moving parts — Redis, a bucket, a
worker — for one nightly dump.

Use a Railway **scheduled service** instead, matching the convention already in
[`../SCHEDULING.md`](../SCHEDULING.md):

- Service: `backup`, root directory `backend`, no public domain
- Command: `npm run backup:postgres`
- Schedule: `0 2 * * *`
- Variables: `DATABASE_URL=${{postgres.DATABASE_URL}}`, `BACKUP_DIR=/data/backups`

### The ephemeral filesystem

**A container's disk does not survive a redeploy.** `BACKUP_DIR` defaults to
`./backups`, so a nightly dump written there is gone the next time you ship —
and gone entirely when the container that holds it is the one that died.

Mount a Railway **volume** on the `backup` service at `/data` and point
`BACKUP_DIR` at `/data/backups`. Better still, once there is a bucket, copy each
dump off-box: a volume attached to the same project does not protect against
losing the project.

Set `BACKUP_RETENTION_DAYS=30` and size the volume for thirty dumps of a café's
database, which is small.

---

## The restore drill on Railway

With `postgres-drill` created, run the drill from your own machine against the
Railway databases — it needs `pg_dump`/`pg_restore`/`psql` locally, and pointing
it at Railway's public database URLs is fine for a café-sized database:

```bash
cd backend
export DATABASE_URL="<postgres public URL>"
export RESTORE_TEST_DATABASE_URL="<postgres-drill public URL>"
export ALLOW_RESTORE_TEST_DB=true
npm run drill:restore:check   # confirms the wiring, touches nothing
npm run drill:restore
```

The drill will refuse if the target's name does not look like a scratch
database. Railway names databases `railway` by default, which **will be
refused** — rename the drill database to something containing `drill` or
`restore`, which is also what stops a tired hand pointing it at the live one.

Run it before the café goes live, and again after any release that migrates.

---

## What Railway does not give you

- **Railway's own database backups are not a restore drill.** Whatever the plan
  includes, nobody has proven a restore of *this* schema until step 7 passes.
- **No staging by default.** Make a second Railway environment before the first
  migration you are unsure about, not after.
- **Logs are not alerting.** Point an uptime check at `/health/ready` on both
  public services; see [`../ALERTING_RUNBOOK.md`](../ALERTING_RUNBOOK.md).
