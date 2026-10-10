# Mini ERP roadmap

Status: updated 6 October 2026. This is a personal project with one
fictional small distributor as its reference business. It aims to show dependable
business workflows and professional engineering without claiming SAP parity or
becoming a general purpose SaaS platform.

## Current position

The application already connects customers, suppliers, products, inventory,
purchase orders, sales orders, invoices, payments, and operational analytics.
Purchase receipts add stock, including partial deliveries; confirming a sale
reserves stock; partial shipment dispatch consumes the shipped reservation, and
invoicing is available after the full order ships. Price and cost snapshots
preserve historical document amounts.
There is a movement history, REST API, server rendered interface, Prisma
migrations, and a separate change aware Playwright workflow.

This is currently an **operations and inventory mini-ERP**, not a full
accounting or general-purpose ERP. In comparison with established products such
as Odoo or ERPNext, it intentionally has a narrower functional scope. The next
product expansion should complete adjacent operational workflows before
considering a general ledger or other specialist modules.

The earlier assessment was **7.5/10 as a personal project** and **3/10 as a
business deployment**. Treat those as a historical baseline, not a current score.
The current deployment-readiness estimate and the quickest evidence-led route
to improve it are tracked in the [production readiness acceleration plan](PRODUCTION_READINESS_ACCELERATION_PLAN.md).
Since then, the app added role-enforced web/API permissions, pending public
signup with verified email and Admin approval, one-use email recovery links,
CSRF protection, startup configuration validation, browser security headers,
append-only application audit events, database checks for core quantities and
amounts, and PostgreSQL row locks across the main stock and money transitions.
Payment APIs also support idempotent retries. A disposable PostgreSQL CI job now
tests backup restoration and data integrity; it is not a hosted backup service.
Local tests and a separate reviewed Playwright contract suite cover these
behaviors. The site is still not ready for live business data: production SMTP
secrets need configuration, hosted backup retention, staging restore rehearsal,
deployment monitoring, broader failure recovery, and a signed-in desktop/mobile
usability review remain open. Admins can change approved users'
roles; role and password changes revoke existing sessions. A passing build and
health response do not establish production readiness.

## Product boundary

- One company and one coherent demo dataset. Avoid tenancy, marketplaces, or a
  plugin platform until the core can be operated reliably.
- Give the project its own name, visual language, terminology, and sample data.
  Take inspiration from integrated ERP workflows, not another product's screens.
- Make operational reports explicit about what their numbers mean. Do not label
  collections minus purchases as profit. Do not claim full accounting until
  journals, reconciliation, and accounting rules exist.
- Prefer a complete workflow with tests and recovery over another shallow module.

## Milestones

The effort estimates assume one developer working part time. They are planning
ranges, not release commitments. Finish each exit criterion before starting the
next milestone.

### 0. Define the business contract (2 to 4 days)

1. Write a one page story for the fictional distributor: users, products, a
   supplier, a customer, and the purchase to sale to payment journey.
2. Document the allowed state transitions for purchase orders, sales orders,
   shipments, invoices, and inventory. Sales invoices are issued after all
   ordered quantities have shipped; shipment dispatch consumes reserved stock.
3. Write a permission matrix for Admin, Sales, Purchasing, and Inventory roles.
   Include every page and API mutation, plus analytics export.
4. **Partially complete:** capture representative desktop/mobile pages and
   review layout, labels, focus, empty states, and errors. The 30 September
   synthetic-fixture review is recorded in [UI review](UI_REVIEW_2026-09-30.md);
   the suite checks all screens at 320, 390, and 1440 CSS pixels. Still review
   keyboard-only flows and the signed-in UI in a supervised real environment.

**Exit:** A reviewer can explain the workflow, roles, and limits without reading
the implementation.

### 1. Secure access and actions (1 to 2 weeks)

1. **Implemented:** enforce role permissions on web and API routes. Continue
   exercising denied as well as allowed actions in the reviewed contracts.
2. **Implemented:** public signup creates a pending account; an Admin must
   approve it and assign a role before access is granted.
3. **Implemented:** CSRF protection for browser forms, production secure
   cookies, startup validation for database URLs/JWT secret/port/CORS origins,
   and browser security headers.
4. **Implemented:** limit web/API sign-in to 10 attempts per IP and public
   signup to 5 attempts per IP in a 15-minute window using atomic PostgreSQL
   buckets. The stored client keys are HMACs, so raw IP addresses are not
   persisted. Account approval, role changes, deactivation/reactivation, and self-service
   password changes advance a token version so existing API and browser sessions
   stop working. Password changes verify the current password. Email verification
   and one-use password recovery are implemented; SMTP is mandatory in staging
   and production, and the browser contracts verify the explicit confirmation
   and reset flows.
5. Continue broadening tests for anonymous access, wrong roles, expired sessions,
   forged form requests, and allowed actions across every page and mutation.

**Exit:** A signed in Sales user cannot adjust stock or record a payment unless
the matrix permits it, through either the page or the API. A forged form POST is
rejected. A disabled account cannot keep acting with an old token.

### 2. Make transactions safe under retries and concurrency (1 to 2 weeks)

1. **Implemented:** payment balance checks and writes share a transaction;
   invoice row locks serialize concurrent payments, and database constraints
   reject invalid core quantities and amounts.
2. **Implemented for core transitions:** confirmation, cancellation, invoicing,
   purchase receipt, stock changes, and payments recheck state under PostgreSQL
   row locks. Keep expanding race and rollback coverage.
3. **Partially implemented:** API payment recording, purchase receipt, and
   manual stock addition accept `Idempotency-Key`; identical retries return
   the existing result without repeating money or stock movements, and reusing
   a key with different details is rejected. Invoice issuance returns the
   existing invoice when the same order is retried after commit, without
   repeating stock consumption or its audit event. Add explicit idempotency
   keys for any remaining externally repeatable transitions that need caller
   supplied retry identity.
4. **Partially implemented:** `npm run db:reconcile` runs read-only checks for
   product inventory coverage, order reservations, invoice snapshots and totals,
   payments, and purchase/sale movement references. CI runs it against its
   disposable database. Add a documented opening-balance model before treating
   the movement ledger as a complete reconciliation of on-hand quantity, and
   continue expanding checks for every allowed order transition.
5. Test failed transactions and simultaneous requests against a disposable
   database. Preserve the existing historical price and cost snapshots.

**Exit:** Parallel requests cannot overpay an invoice, double receive a
purchase order, consume stock twice, or leave a partially applied workflow.

### 3. Make the app deployable and recoverable (1 to 2 weeks)

1. **Implemented:** local config/auth tests, typecheck/build, the companion
   reviewed Playwright contracts, and isolated PostgreSQL CI. Keep these gates
   passing as workflows change.
2. Prepare a staging environment with HTTPS, environment specific secrets,
   an automated deployment checklist, and migration step. For the current
   Prisma 5 setup, use `prisma migrate deploy` outside development. Test the
   PostgreSQL schema and migrations in staging before changing the production
   database; switching providers is more than changing one schema line.
3. **Partially implemented:** a readiness endpoint checks database access
   separately from liveness, committed business events appear in the Admin
   activity log, and HTTP requests emit structured logs with generated request
   IDs. Add log shipping and error alerts; current logs exclude request bodies,
   query strings, cookies, and authorization headers.
4. **Partially implemented:** CI dumps and restores its disposable PostgreSQL
   database and compares key business row counts and payment totals. Automate
   hosted database backups, document retention, and restore into a staging
   instance. A documented [restore and cutover runbook](OPERATIONS_RECOVERY.md)
   is ready for rehearsal. Rehearse it for failed deployment and migration.
5. Track dependency updates and security advisories; review upgrades through
   the same CI gates.

**Exit:** A fresh staging instance can be deployed from the documented steps,
the core workflow passes, and a backup can be restored to a working instance.

### 4. Complete the existing business flow (2 to 4 weeks)

Build in this order, stopping when the portfolio story is complete:

1. **Partially implemented:** append-only audit events cover account requests,
   approvals/access changes, stock, sales, purchasing, invoice, and payment
   actions in a readable Admin activity log. Expand coverage to edits and
   reversals as those workflows are added.
2. **Partially implemented:** reasoned manual stock count corrections can add
   or remove units, preserve existing reservations, and retry safely. Purchase
   receipts support partial line quantities with receipt history and retry
   protection; outstanding quantities remain open commitments and receipt cost
   is dated per delivery. Products have configurable reorder points that drive
   dashboard and analytics alerts. Next add reorder proposals that create draft
   purchase orders. Add warehouses only when the single location flow is
   reliable.
3. **Partially implemented:** invoices have editable-at-issue due dates and
   customers show outstanding and overdue balances. Invoice returns now create
   auditable credit notes, enforce cumulative return quantities, and restock
   only items marked resaleable. Orders support partial shipment history and
   consume reserved stock only when dispatched. Next, handle cancellation of
   unshipped remainder and apply customer credits to other invoices.
4. **Usability at volume:** server side search, filters, pagination, clearer
   validation errors, responsive tables, accessibility review, and realistic
   demo data.

**Exit:** A user can trace a purchase through stock, a sale, one or more
shipments, an invoice, a payment, and a return while balances remain explainable.

### 5. Adjacent modules (optional, one at a time)

The next feature phase closes the most visible gaps in the existing order-to-cash
and inventory workflows. Implement each as an end-to-end, audited, permissioned
workflow across the database, API, web UI, and tests; do not add placeholder
screens or imply accounting behavior that does not exist.

1. **Returns and credit notes — first slice implemented:** record a return
   against an invoice, validate cumulative quantities against invoice lines,
   preserve historical unit prices, issue an auditable credit note, and restock
   only items marked resaleable. A paid invoice can produce an account credit;
   this version does not issue cash refunds or apply the credit to a different
   invoice. Expand return tests and reconciliation, then design cross-invoice
   credit application as a separate balance-safe workflow.
2. **Shipment and delivery records — first slice implemented:** shipments track
   dispatched quantities and timestamps, may partially fulfil an order, and
   consume reserved stock at dispatch. Existing invoiced orders are backfilled
   as shipped history. The initial version allows one invoice only after all
   ordered quantities are shipped and blocks cancellation after a dispatch.
   Next, define how to close an order with an unshipped remainder without
   misrepresenting the already-dispatched goods.
3. **Multiple inventory locations:** introduce warehouses/locations, transfers,
   and location-level available/reserved quantities only after the single-location
   flow is reliable. Preserve a clear aggregate stock view and reconcile
   movements between locations.
4. **Financial foundation:** only after the operational documents are stable,
   define accounting ownership, tax requirements, currencies, and an auditable
   posting model. General ledger, journals, reconciliation, and financial
   statements require an explicit accounting design and knowledgeable review;
   do not present basic invoice/payment totals as accounting.

| Module | Smallest useful version | Depends on |
| --- | --- | --- |
| CRM | Lead, opportunity, and conversion to customer or sales order | Role rules and customer history |
| Replenishment | Low stock proposals that become draft purchase orders | Reorder points and reliable available stock |
| Approvals | Review queue for high value purchase orders or adjustments | Roles and audit trail |
| Reporting | Saved operational views and documented CSV exports | Metric definitions and pagination |
| Finance | Ledger, journals, tax, reconciliation, then statements | Explicit accounting model and expert review |

Do not start payroll, manufacturing, multi company, localization, or an AI
assistant merely for breadth. Each new module should reuse existing records and
complete a business task end to end.

## Portfolio presentation

Show a five minute demo of one purchase to payment journey and one recovery or
denied access case. Publish the architecture diagram, state transitions,
permission matrix, CI results, and the limits of the demo. A credible target is
roughly **9/10 as a portfolio project** after milestones 1 to 4. A narrow,
operated small business deployment might reach **6 to 7/10** after real usage,
monitoring, security review, and a restore drill. Neither score implies a
general enterprise ERP.

## Reference benchmarks

- [SAP Business One scope](https://www.sap.com/products/business-one.html) for
  the idea of connected small business workflows.
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
  and [CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
  for security requirements.
- [Prisma migration deployment](https://docs.prisma.io/docs/cli/migrate/deploy)
  for the current migration command; verify the guidance for the installed
  Prisma version when upgrading.
