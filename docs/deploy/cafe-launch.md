# Café launch runbook

Deploying KiranaOS and DineIn together for one small café: ten tables or fewer,
one billing counter, payment taken at the counter.

Three services, two repositories:

| Service | Repo | What it is |
|---|---|---|
| `backend` | this repo | Node/Express + Prisma + PostgreSQL. The only thing holding data. |
| `frontend` | this repo | The till. A static PWA the counter runs. |
| `dinein` | `dinein` repo | The guest's QR menu (Next.js). Talks only to `backend`. |

They are joined by **one shop id**. DineIn maps its restaurant slug to the
KiranaOS shop id through `KIRANAOS_SHOP_MAP`; get that wrong and the menu loads
from nowhere.

> **Scope.** This runbook covers a single-café deployment on counter payments.
> It does **not** cover connecting a payment provider — those credentials are
> deployment-wide today, so several cafés behind one merchant account do not
> have isolated settlements. Onboarding a second paying café needs per-restaurant
> merchant routing first.

---

## 0. Before you start

Have these ready. Everything else in this document assumes they exist.

- A PostgreSQL database, and a **second, empty** one for restore drills.
- A host for each service, each on HTTPS.
- `pg_dump`, `pg_restore` and `psql` on whatever machine runs the drills.
- A password manager or secret store. Nothing below belongs in a repo.

Generate the secrets once and keep them:

```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('METRICS_TOKEN=' + require('crypto').randomBytes(24).toString('base64url'))"
node -e "console.log('BACKUP_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64url'))"
```

**Write `BACKUP_ENCRYPTION_KEY` down somewhere that survives the server.** An
encrypted backup whose key lived only on the machine that died is not a backup.

---

## 1. Configure the backend

`backend/.env`. The authority for this list is `scripts/production-preflight.js`
— it fails the deploy on each of these, so this table is a copy of the rules,
not a wish list.

| Variable | Value | Why it is enforced |
|---|---|---|
| `NODE_ENV` | `production` | |
| `DATABASE_URL` | `postgresql://…` | SQLite is refused in production |
| `DIRECT_DATABASE_URL` | raw port, if you use a pooler | migrations bypass PgBouncer |
| `JWT_SECRET` | 32+ chars, unique | placeholder-looking values are refused |
| `ALLOWED_ORIGINS` | the till and DineIn HTTPS origins, comma-separated | no `*`, no `localhost`, no `http://` |
| `METRICS_REQUIRE_TOKEN` | `true` | |
| `METRICS_TOKEN` | 24+ chars | open metrics are refused |
| `ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION` | `false` | must be off in public production |
| `STOREFRONT_WRITE_LIMIT_MAX` | `1000` | guest order writes / 15 min |
| `STOREFRONT_READ_LIMIT_MAX` | `20000` | guest menu reads / 15 min |

Turn on automatic backups — this is what buys the recovery point the drill later
measures:

```ini
DATABASE_BACKUP_ENABLED=true
DATABASE_BACKUP_INTERVAL_HOURS=24
BACKUP_RETENTION_DAYS=30
BACKUP_ENCRYPTION_KEY=<the key from step 0>
```

Leave off for a café on counter payments: `RAZORPAY_ENABLED`, `GST_PROVIDER=gsp_http`,
`QUEUES_ENABLED`, `WHATSAPP_PROVIDER`. Each pulls in credentials the preflight
will then insist are real.

**Gate — do not continue until this passes:**

```bash
cd backend && npm run prod:preflight
```

---

## 2. Migrate the database

Migrations run **before** the new backend starts, never alongside it.

```bash
cd backend
npm run migration:safety     # refuses a migration that would drop or rewrite data
npm run deploy:migrate       # prisma deploy + generate + product schema verify
```

Take a backup first if the database already holds trade:

```bash
npm run backup:postgres
```

---

## 3. Deploy the backend, then check it

```bash
curl -fsS https://<backend>/api/health
curl -fsS "https://<backend>/api/public/shops/<shopId>/catalog" | head -c 400
```

The catalog must return the café's menu. If it 404s, guest ordering is off for
that shop — turn on **Customer QR ordering** in the till's settings.

---

## 4. Deploy the till

```bash
cd frontend && npm run prod:check    # typecheck, tests, build, bundle budgets
```

Serve `frontend/dist/public`. Its origin must be in the backend's
`ALLOWED_ORIGINS`.

---

## 5. Configure and deploy DineIn

`dinein/.env` — see `dinein/.env.production.example`:

```ini
NODE_ENV=production
ORDERING_GATEWAY=http
KIRANAOS_BASE_URL=https://<backend>
KIRANAOS_SHOP_MAP={"<restaurant-slug>":"<kiranaos-shop-id>"}
KIRANAOS_TIMEOUT_MS=8000
```

Three ways this goes wrong, all silent:

- **`ORDERING_GATEWAY=mock`** serves seed data. A café taking orders for dishes
  it does not sell. Never deploy this.
- **`DINEIN_CLOCK` set** freezes time and breaks opening hours. Never deploy this.
- **A wrong shop id** loads an empty or foreign menu. Check it against step 3's
  catalog response before printing a single QR sticker.

Then:

```bash
cd dinein && npm run build && npm run start:production
```

---

## 6. Prove the whole path end to end

Against the deployed services, not localhost:

```bash
curl -fsS https://<dinein>/r/<slug>/t/<tableCode> -o /dev/null -w '%{http_code}\n'   # 200
```

Then on a real phone: scan the sticker, order, and confirm the order appears in
the till's **Guest orders** strip. Accept it, fire the ticket, and confirm it
lands on the Kitchen board. Ask for the bill and check the total matches what
the counter shows.

**Print QR stickers only after this passes.** A sticker is expensive to reprint
and impossible to recall once it is glued to a table.

---

## 7. Prove you can get the data back

A backup nobody has restored is not a backup.

```bash
cd backend
npm run drill:restore:check     # says what is missing, touches nothing
```

Then, with a **second, empty** database whose name contains `restore` or `drill`:

```bash
export DATABASE_URL="postgresql://…/kiranaos"
export RESTORE_TEST_DATABASE_URL="postgresql://…/kiranaos_restore_drill"
export ALLOW_RESTORE_TEST_DB=true
npm run drill:restore
```

It backs up the live database, restores into the scratch one, and compares them
— shops, bills, **integer-paise bill totals**, customer orders, restaurant
tables, audit rows. Any variance fails. It also reports how old the backup was,
because a restore that works from a three-week-old dump has still lost three
weeks.

The drill refuses to run if the restore target's name looks like production, and
never writes to the source.

Run it **before the café goes live**, and again whenever the schema changes.

---

## Rollback

1. Put the till and DineIn back on the previous build.
2. Leave the database alone unless the release included a migration.
3. If it did, restore the pre-migration backup into a scratch database first and
   check it with the drill above before touching the live one.

Roll back the apps freely. Roll back the database only with a verified restore
in hand.

---

## What this café is buying

Write this into the agreement. Each of these is fine stated plainly and becomes
a complaint discovered on a busy evening.

- **Up to ten tables open at once.** The eleventh seating is refused with a clear
  message until a table is settled.
- **One billing counter.** Open table bills live on that device. The kitchen
  board is shared; the floor is not.
- **Payment at the counter.** No guest online payment.
- **Staff screens in English or Hindi.** Menu setup, kitchen stock and QR
  printing are English only.
- **Estimated totals on the guest's phone.** The counter's bill is the one that
  counts.
