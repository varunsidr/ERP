# ERP

The development application for the ERP environment: a compact, server-rendered
ERP-style site with a REST API.

## Scope

This repository contains only the mini-ERP application. It is intentionally
separate from the Playwright test repository so the application can be deployed
as an independent development, staging, or production-like target.

The application includes:

- cookie-based web authentication and JWT API authentication
- server-enforced Admin, Sales, Purchasing, Inventory, and read-only Staff roles; public account requests verify email and wait for Admin approval; password recovery revokes existing sessions
- per-IP sign-in and signup attempt limits, with configurable proxy-hop trust for deployments behind a known proxy chain
- self-service password changes verify the current password and revoke existing sessions
- customers, suppliers, products, and inventory
- sales orders, purchase orders, invoices, and payments
- atomic stock reservation, receipt, release, and consumption workflows
- partial purchase deliveries with receipt history and reasoned stock count corrections
- per-product reorder points that drive inventory, dashboard, and analytics alerts
- Prisma migrations and deterministic development seed data
- an Admin-only activity log for committed account, stock, sales, purchasing, invoice, and payment actions
- an authenticated operational analytics cockpit with period filters and daily CSV export

See the [product and production-readiness roadmap](docs/ROADMAP.md) for the
prioritized milestones, acceptance criteria, and project scope.
See [access control](docs/ACCESS_CONTROL.md) for the permission matrix and remaining security work.
`npm run db:reconcile` performs read-only cross-record checks for inventory
reservations, order/invoice snapshots, payment totals, purchase receipts,
customer-return quantities, credit notes, and receipt/consumption/restock
movements. It reports mismatching counts without printing record identifiers.
See the [database recovery runbook](docs/OPERATIONS_RECOVERY.md) for the
staging restore and cutover procedure; it still needs a staging rehearsal.
See the [staging deployment runbook](docs/STAGING_DEPLOYMENT.md) for the
immutable container, release preflight, verification, and rollback procedure.
For the personal demo, see the [free Render + Neon + Brevo deployment guide](docs/FREE_DEPLOYMENT_RENDER_NEON.md)
for verified provider settings, separate migrations, and hosted verification steps.
See the [monitoring and incident runbook](docs/OPERATIONS_MONITORING.md) for
structured signals, starting alert thresholds, and response procedures.

## Stack

TypeScript, Node.js, Express, EJS, Prisma, and PostgreSQL. Hosted Neon is the
target database; see the migration guide before connecting the app.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run prisma:generate
npm run prisma:migrate:deploy
npm run db:seed
npm run dev
```

Set `DATABASE_URL` to Neon's pooled connection string for app traffic and
`DATABASE_URL_UNPOOLED` to its direct connection string for Prisma migrations. Keep both in
the ignored `.env` file; never commit them. The application listens on
`http://localhost:4000` by default. Set `PORT` in `.env` to use another port.
Set `NODE_ENV=development` for local work. `npm run dev` supplies it when it is
not already set; `npm start` defaults to `production`. The server refuses to
start unless `NODE_ENV` is explicitly one of `development`, `test`, `staging`,
or `production`.

Staging and production also require `APP_RELEASE_SHA` to contain the full Git
commit SHA. Responses include that value in `X-ERP-Release`, allowing operators
to verify which revision is serving traffic.

Set `ERP_SEED_ADMIN_PASSWORD` to a unique password before seeding Neon; the
local-only default is not allowed for hosted databases.

In development, account verification and password recovery links appear in the
server console. Staging and production require SMTP settings (`MAIL_HOST`, `MAIL_PORT`,
`MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`) and an HTTPS `PUBLIC_APP_URL`; keep
these values in the deployment secret store. See [access control](docs/ACCESS_CONTROL.md).

`/health` reports process liveness. `/ready` also queries PostgreSQL and returns
503 when the database is unavailable; use `/ready` for deployment readiness checks.
The API does not grant cross-origin browser access by default. If an external
frontend is required, set `CORS_ORIGINS` to comma-separated exact origins.

After signing in, open `http://localhost:4000/analytics` for 7/30/90-day
invoicing, collections, purchase receipts, sales pipeline, top products and
current receivables/stock alerts. The **Export daily CSV** button downloads
date-level transaction totals suitable for Power BI Desktop's CSV import.
See [analytics definitions and Power BI steps](docs/ANALYTICS.md).

Do not commit `.env`, `prisma/dev.db`, or production secrets. The SQLite
database and old SQLite migration SQL are retained and are not applied to Neon.
Existing SQLite records are not imported automatically; follow the
[PostgreSQL migration guide](docs/POSTGRES_MIGRATION.md) before using real data.

## Verification commands

```powershell
npm run typecheck
npm run build
npm start
node scripts/smoke-access.cjs
```

For a staging release, build the container with its immutable revision and run
`npm run release:preflight -- <full-commit-sha>` before applying migrations.
The staging deployment runbook contains the complete sequence.

## Repository boundary

The companion repository, `ai-self-healing-test-automation-framework`, contains
the Playwright tests and CI workflows. It should target a deployed instance of
this application through environment configuration rather than sharing source
files with this repository.

## Automatic change-aware tests

The **Change-aware ERP tests** GitHub workflow runs after a push to `main`, for
same-repository pull requests targeting `main`, and on manual dispatch. It calls
the companion test repository's composite action at a pinned commit. All test
implementation stays in the test repository.

The action analyzes the base/head Git diff, generates Playwright tests from
reviewed contracts, builds this ERP revision, and runs against a fresh temporary
PostgreSQL service. Plans, generated tests, review drafts and reports are attached
to the workflow run as private artifacts. A manual run can execute all 18 reviewed contracts.

See the [automation approach and roadmap](https://github.com/ashishbarthwal/ai-self-healing-test-automation-framework/blob/main/docs/CHANGE_AWARE_AUTOMATION.md).
New requirements and changed business behavior still need review; AI healing is
not enabled in this first foundation.

Each completed pipeline run also publishes an `erp-analytics` artifact containing
sanitized run/test history and CSVs for Power BI. In the test repository, use
`npm run analytics:sync` to collect these artifacts and rebuild local report data.
See the [Power BI setup guide](https://github.com/ashishbarthwal/ai-self-healing-test-automation-framework/blob/main/analytics/powerbi/README.md).

## Test support (local, CI and staging demos only)

Set `ERP_TEST_SUPPORT=enabled` and `ERP_TEST_SUPPORT_TOKEN` (24+ characters) to mount
token-protected helpers under `/__test`. Startup rejects this in production, and the
routes return 404 without the `x-erp-test-token` header.

- `POST /__test/reset` wipes all data and sessions and restores the baseline (admin, one
  customer, product and supplier). Send `{"roleUsers": true}` to also create
  `sales@`, `purchasing@`, `inventory@` and `staff@mini-erp.test` with the seed password.
- `GET /__test/emails?to=<address>` returns verification/reset links captured by
  `MAIL_MODE=outbox`; `DELETE /__test/emails` clears them.
- Raise `AUTH_LOGIN_ATTEMPT_LIMIT` / `AUTH_SIGNUP_ATTEMPT_LIMIT` (up to 1000) so parallel
  test workers do not hit rate limits.
- `docker compose up --build -d` starts the app and a disposable PostgreSQL on
  `http://localhost:4000` with these settings; call the reset endpoint to load data.
