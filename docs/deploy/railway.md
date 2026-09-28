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
npm run deploy:migrate:postgres && npm run start:runtime
```

So on Railway **every deploy migrates before the API starts**. You do not run
`deploy:migrate` by hand; the manual steps in the launch runbook are for
non-Docker hosts.

The backend image also installs PostgreSQL 18 client tools from the signed
[PostgreSQL APT repository](https://www.postgresql.org/download/linux/debian/).
The image build executes `pg_dump`, `pg_restore`, and `psql` to check that the
backup worker and scheduled backup service can use them inside the container.
Keep this client major aligned with the deployed database: `pg_dump` cannot dump
a server running a newer major version than itself. The deployed server was
verified as PostgreSQL 18.6 on 27 September 2026; testing only against CI's
PostgreSQL 16 database did not establish that the previous version-16 client
could back up production. Version 18 supports both server versions. Check the
actual server version before a PostgreSQL upgrade.

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
domain, which keeps guest traffic off the public edge.

DineIn's own guard will not stand in the way: `validateProductionEnvironment()`
rejects only `localhost`, `127.0.0.1` and `::1`, and accepts `http:` as well as
`https:`, so an internal URL passes. **Railway's side still needs confirming** —
its private network is IPv6-only, so the backend has to be listening on `::`
rather than `0.0.0.0` for the name to resolve. If a private URL 502s, that is
the reason; use the public domain and move on. It is one café's traffic.

That guard is worth knowing in full, because it stops the container rather than
degrading: in production it refuses to start unless `ORDERING_GATEWAY=http`,
`KIRANAOS_SHOP_MAP` parses and maps at least one slug, `KIRANAOS_TIMEOUT_MS` is
between 1000 and 30000, and `DINEIN_CLOCK` is unset. A misconfigured DineIn
fails its deploy instead of serving a café the wrong menu.

---

## Config as code

`backend/railway.json` and `dinein/railway.json` carry the build and deploy
settings, so a rebuilt service comes back configured rather than depending on
someone remembering which fields were filled in. Railway reads them from the
service root, which is why each sits beside its own Dockerfile.

Both set `builder: DOCKERFILE`. Neither sets `startCommand`, and that omission
is load-bearing:

> **Do not add `startCommand` to `backend/railway.json`.** It overrides the
> Dockerfile `CMD`, and the backend's CMD is what runs `prisma:deploy:postgres`
> before `npm start`. Setting a start command here would skip migrations
> silently — the API would boot happily against an out-of-date schema.

`healthcheckTimeout` is 300s on the backend for the same reason: the first
deploy against an empty database runs every migration before the port opens,
and a shorter timeout would kill it mid-migration and retry from the top.

The frontend has **no** `railway.json`. It is a Vite build with no Dockerfile,
and its `serve` script is `vite preview`, which Vite's own documentation says is
not for production. Configure that service deliberately — a static host, or a
real static server in a container — rather than inheriting a preview server.

---

## Health checks

| Service | Path |
|---|---|
| `backend` | `/health/ready` — checks the database, not just the process |
| `dinein` | `/api/health/ready` |

Both Dockerfiles already declare these, and `railway.json` sets them for the
deploy gate too.

**DineIn's readiness depends on the backend.** `/api/health/ready` calls
`KIRANAOS_BASE_URL/api/health` and returns 503 if it cannot reach it — so
DineIn's deploy will fail its health check while the backend is down. Deploy
the backend first, and do not diagnose a red DineIn deploy before checking the
backend is green.

Verified locally against the built images: DineIn's container answers
`/api/health/ready` with `200 {"status":"ready","service":"DineIn"}` and Docker
reports the container `healthy`. `/api/health`
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
[`backend/docs/SCHEDULING.md`](../../backend/docs/SCHEDULING.md).

### Scheduled off-site backups

The `backup` service runs `npm run backup:postgres:offsite` once a night. That
command dumps the database with the image's PostgreSQL 18 `pg_dump`, uploads the
dump to an S3-compatible bucket, reads it back and compares the SHA-256, prunes
copies older than `BACKUP_RETENTION_DAYS` (never fewer than
`DATABASE_BACKUP_MIN_RETAINED`), and deletes the local file. If any step fails,
the process exits non-zero and Railway marks that run failed. It refuses to
start without a bucket, before it dumps anything. Without that check, a
misconfigured run would exit 0 after writing a dump to a disk that is discarded
with the container.

**1. Make the bucket outside Railway.** A bucket in the same Railway project
does not survive losing the project, which is one of the things an off-site copy
is for. Cloudflare R2 or AWS S3 both work. Create one private bucket and a key
scoped to that bucket with read, write, list and delete permissions. Delete is
needed for retention.

**2. Create the service.**

- New service from this repo, root directory `backend`, no public domain.
- **Settings → Config-as-code → config file path: `/backend/railway.backup.json`.**
  Do not skip this step. Without it the service reads `backend/railway.json`,
  which is the API's config: it has no schedule, and its health check waits for
  an HTTP server that a backup job never starts.

[`backend/railway.backup.json`](../../backend/railway.backup.json) sets the
start command, `restartPolicyType: NEVER` (a failed run should stay failed, not
turn into a second dump), and the schedule `30 20 * * *`. Railway cron runs in
UTC, so that is **02:00 Asia/Kolkata**, after closing. The earlier `0 2 * * *`
here meant 07:30 IST.

**3. Variables.** The job loads the backend's production configuration check,
so it needs the same secrets the API does, or it exits before dumping. Use
references so a rotated secret reaches both services:

```ini
# backup
DATABASE_URL=${{postgres.DATABASE_URL}}
JWT_SECRET=${{backend.JWT_SECRET}}
LICENSE_SIGNING_SECRET=${{backend.LICENSE_SIGNING_SECRET}}
INTEGRATION_SIGNING_SECRET=${{backend.INTEGRATION_SIGNING_SECRET}}
METRICS_REQUIRE_TOKEN=true
METRICS_TOKEN=${{backend.METRICS_TOKEN}}
ALLOWED_ORIGINS=${{backend.ALLOWED_ORIGINS}}

STORAGE_PROVIDER=r2                      # or s3
STORAGE_BUCKET=<bucket>
STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com   # omit for AWS S3
STORAGE_REGION=                          # R2 defaults to auto; set it for AWS S3
STORAGE_ACCESS_KEY_ID=<bucket-scoped key>
STORAGE_SECRET_ACCESS_KEY=<bucket-scoped secret>

BACKUP_RETENTION_DAYS=30
DATABASE_BACKUP_MIN_RETAINED=3
```

Any other production-only toggle turned on for the backend, such as
`RAZORPAY_ENABLED` or `WHATSAPP_PROVIDER`, carries its own required variables.
Either reference those too or leave the toggle unset on `backup`. Do **not** set
`DATABASE_BACKUP_ENABLED` on the backend as well unless Redis and the worker
are running. The npm script turns it on for this job alone.

**4. Prove it before trusting the schedule.** Check the configuration from the
service shell (`railway ssh --service backup`, or a one-off run) with
`BACKUP_DRY_RUN=true npm run backup:postgres:offsite`. It exits non-zero on a
missing bucket and connects to nothing. Then trigger one real run from the
service's cron panel and confirm the last log line:

```json
{"type":"postgres_backup_offsite","status":"passed","verified":true, ...}
```

The object lands at `backups/database/<database>/kiranaos-<database>-<UTC timestamp>-<uuid>.dump`.

**5. Know when it stops.** A failed cron run is visible only in the service's
run history. Check it weekly, or have your bucket provider alert on no new
object under `backups/database/` for 36 hours. An off-site copy that nobody has
restored is still unproven. Pull one down and restore it with the
[restore drill](#the-restore-drill-on-railway) before counting on it.

### The ephemeral filesystem

**A container's disk does not survive a redeploy.** `BACKUP_DIR` defaults to
`./backups`, so a dump written there is gone the next time you ship, and gone
entirely when the container that holds it is the one that died. The scheduled
service above never relies on it: its copy is the one in the bucket. A volume
attached to the same project does not protect against losing the project.

The API's local object storage uses `/app/storage` in the Docker image. A volume
attached to the API at `/var/lib/postgresql/data` does **not** persist those
exports or its default `/app/backups` directory. The application service is
separate from the Postgres service; each has its own volume and mount path.
For local storage on the API, mount its volume at `/app/storage` and set
`BACKUP_DIR=/app/storage/database-backups`. Before changing an existing mount,
preserve and verify any current `/app/storage` and `/app/backups` contents;
remounting does not move files out of the old container. Never change the
Postgres service's data mount as part of this application-storage correction.

A persistent directory is not an automatic backup schedule. The built-in
database-backup schedule requires `DATABASE_BACKUP_ENABLED=true`, a healthy
Redis worker, and configured S3-compatible object storage. If relying on
Railway-managed backups instead, verify the project's plan supports them and
that a schedule and retained restore points exist; volume attachment alone
does not establish backup coverage.

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
npm run drill:restore:check   # validates configuration only; no connection test
npm run drill:restore
```

The drill will refuse if the target's name does not look like a scratch
database. Railway names databases `railway` by default, which **will be
refused** — rename the drill database to something containing `drill` or
`restore`, which is also what stops a tired hand pointing it at the live one.

Run it before the café goes live, and again after any release that migrates.
Use representative data in an isolated test source for a pre-launch rehearsal;
an empty business schema cannot pass. This command verifies a fresh snapshot,
not the freshness or retention of scheduled Railway backups. See the
[recovery runbook](../../backend/docs/DISASTER_RECOVERY.md) for verifying a
particular retained dump.

---

## What Railway does not give you

- **Railway's own database backups are not a restore drill.** Whatever the plan
  includes, nobody has proven a restore of *this* schema until step 7 passes.
- **No staging by default.** Make a second Railway environment before the first
  migration you are unsure about, not after.
- **Logs are not alerting.** Point an uptime check at `/health/ready` on both
  public services; see [`backend/docs/ALERTING_RUNBOOK.md`](../../backend/docs/ALERTING_RUNBOOK.md).
