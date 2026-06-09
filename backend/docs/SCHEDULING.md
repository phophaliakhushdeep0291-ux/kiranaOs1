# KiranaOS Scheduling Guide

Daily closing snapshots are generated from authoritative database rows. They are idempotent per `shopId + date`, do not mutate bills/payments/stock/udhar, and never overwrite locked snapshots unless an owner/admin explicitly uses the override route with a reason and owner PIN.

## Manual run

```bash
npm run daily-closing:run
```

Run for one shop/date:

```bash
npm run daily-closing:run -- --shopId=<shopId> --date=2026-06-05
```

Recommended production time: **2 AM Asia/Kolkata**.

Required environment:

```env
DATABASE_URL=postgresql://...
DAILY_CLOSING_TIMEZONE=Asia/Kolkata
DAILY_CLOSING_SCHEDULE_HOUR=2
QUEUES_ENABLED=true
REDIS_URL=redis://...
```

If queues are disabled, the script generates snapshots directly. If queues are enabled, it enqueues `GENERATE_DAILY_CLOSING` for the worker.

## VPS cron

```cron
0 2 * * * cd /opt/kiranaos-backend && /usr/bin/npm run daily-closing:run >> /var/log/kiranaos-daily-closing.log 2>&1
```

Set the server timezone to Asia/Kolkata or keep `DAILY_CLOSING_TIMEZONE=Asia/Kolkata`.

## PM2 cron

```bash
pm2 start scripts/run-daily-closing.js --name kiranaos-daily-closing --cron "0 2 * * *" --no-autorestart
```

## Render cron job

Create a Render Cron Job:

```bash
npm ci && npm run prisma:generate:postgres && npm run daily-closing:run
```

Use the same production `DATABASE_URL`, `REDIS_URL`, and signing/payment env vars as the API/worker where required.

## Railway scheduled job

Create a scheduled service running:

```bash
npm run daily-closing:run
```

Schedule: `0 2 * * *`.

## GitHub Actions schedule

Use a scheduled workflow only if the GitHub runner can securely access the production database. Do not put production secrets in logs.

```yaml
on:
  schedule:
    - cron: '30 20 * * *' # 2 AM Asia/Kolkata
```

## systemd timer

`/etc/systemd/system/kiranaos-daily-closing.service`:

```ini
[Service]
WorkingDirectory=/opt/kiranaos-backend
EnvironmentFile=/opt/kiranaos-backend/.env
ExecStart=/usr/bin/npm run daily-closing:run
```

`/etc/systemd/system/kiranaos-daily-closing.timer`:

```ini
[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

## Safety policy

- Does not overwrite locked snapshots.
- Does not mutate bills, payments, stock, or ledgers.
- Can be rerun safely for the same date.
- Snapshot staleness is reported when records change after generation.

Note: scheduled daily closing does not overwrite locked snapshots.
