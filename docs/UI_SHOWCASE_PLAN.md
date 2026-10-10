# Business showcase UI plan

Status: twenty-fourth site-wide pass implemented, 29 September 2026. This plan covers a visual and
interaction-quality pass for the existing mini-ERP. It is not a claim of SAP/Odoo
equivalence or production security/readiness. Keep the user's separate
`docs/ROADMAP.md` work intact.

The separate test repository now has `npm run test:erp-ui` for repeatable,
database-free render/browser checks of the recent responsive overview,
analytics, and inventory work. The full data-writing contract pipeline remains
a distinct gate against a disposable PostgreSQL test database.

## Reference patterns and what we will borrow

- [SAP Fiori analytical list pages](https://experience.sap.com/fiori-design-web/analytical-list-page/)
  put filters next to the data they control and offer charts alongside tables.
- [SAP Fiori overview guidance](https://experience.sap.com/fiori-design-web/v1-78/overview-page/)
  calls for deliberate hierarchy, a limited number of useful surfaces, and
  consistent semantic status colors. We will use fewer raised boxes, not copy
  Fiori cards or SAP branding.
- [SAP progress indicators](https://experience.sap.com/fiori-design-web/progress-indicator/)
  represent a real completion or threshold and require a visible label. We will
  use sales-stage share, low-stock threshold, and relative product contribution;
  we will not invent a "business health" percentage.
- [Odoo dashboards](https://www.odoo.com/documentation/19.0/applications/productivity/dashboards.html)
  connect real-time metrics with tables and charts. Here, every summary links to
  the existing orders, purchasing, inventory, or invoices screen where possible.
- [SAP object pages](https://experience.sap.com/fiori-design-web/object-page/)
  keep the document header, relevant actions, facts and line content in one flow.
- [SAP list reports](https://experience.sap.com/fiori-design-web/v1-48/list-report-floorplan-sap-fiori-element/)
  distinguish page actions from table controls; the filter belongs directly
  above the register. [Frappe list views](https://docs.frappe.io/framework/user/en/api/list)
  likewise prioritize filters and sorting around operational records.
- [SAP responsive tables](https://experience.sap.com/fiori-design-web/explore_group/table-list-tree/)
  keep the primary record visible on a phone and move secondary fields into
  labelled details below it. [Odoo search](https://www.odoo.com/documentation/19.0/applications/essentials/search.html)
  keeps search and filtering close to the records they affect.

## Current problems in the supplied desktop screenshot

The 1180px content cap leaves large empty gutters on a wide monitor. Five isolated
KPI boxes and several tall, rounded panels use space without increasing information.
The greeting/CTA repeats actions already in the top bar. The right stock panel
stretches below its content. The analytics page has a 90-row daily table and weak
visual hierarchy. "Open sales" currently includes invoiced orders, so even the
most prominent metric can mislead a business viewer.

## Target structure

```text
Persistent navigation | Compact page title + as-of time / actions
                      | Unified KPI strip with drill-down links
                      | Sales order table       | Sales-stage mix
                      | Purchase order table    | Stock threshold watch
                      | Analytics: compact period filter + KPI strip
                      | Invoice/cash chart      | Top products and order mix
```

Desktop content should use the available workspace (up to roughly 1600px) with
small side gutters. Tablets collapse to one column; small screens keep the KPI
strip readable. Detailed document line-item tables may scroll horizontally;
registers should show each record and its labelled details without page-wide
scrolling. Surfaces use
subtle borders, minimal radius and no large shadows. Color means information,
success, warning, or criticality and is always paired with a text label.

The user-provided SAP Business One sales-order reference adds a second, equally
important pattern: a **document workspace** for sales orders, purchase orders and
invoices. Use a compact title/status/action header, factual metadata, a labelled
workflow indicator, anchor tabs, a wide line-item grid and a clear total summary.
Avoid the old split between a large workflow card and a separate products card.
Keep our own product name, fields, and transaction rules; no SAP assets or
branding are copied.

## Second pass: deliberate operator details

The document pages already use the structure above. The next visible mismatch
was a dark, promotional-feeling sidebar beside bare list tables. We now use a
quieter light navigation rail, a restrained active marker, and one consistent
register pattern across sales, purchase, invoice, product, customer, and supplier
lists. Search/status controls sit immediately above the rows they affect; row
counts and no-match messages update together. IDs appear as secondary metadata,
amounts align as numbers, and the product register shows actual usable stock
against the documented 10-unit demo threshold. No arbitrary success score or
decorative chart was added.

The filters are client-side because the current demo tables are small. They are
not a substitute for indexed server-side search and pagination when records grow.
On narrow screens the page itself must remain within the viewport. The existing reviewed contract checks search, status,
document links, and stock progress, and visual QA checks desktop/mobile overflow.

## Third pass: phone-size registers

Sales orders, invoices, purchase orders, products, customers, and suppliers now
show each record with its primary link followed by labelled details on phones.
The mobile sort control offers the same fields and directions as the desktop
column headers. Search, status filtering, row counts, and clear-filters still
act on the same rows. Short lists no longer stretch the navigation row; three
metric summary strips fill their final row rather than leaving a blank cell.
Rendered fixture checks covered all six registers at 390px and desktop sorting
at 1440px. The full reviewed contract suite remains a separate verification
gate after the in-progress PostgreSQL migration is ready for a fresh database.

## Fourth pass: readable documents on phones

Sales orders, purchase orders, and invoices retain their full line-item grids
on desktop. At phone width, each product line presents its SKU, quantity, unit
price or cost, and line total together under the product link. Invoice payment
history uses the same labelled pattern. The earlier sideways-swipe instruction
is removed because these tables no longer require horizontal scrolling on a
390px viewport. Browser render checks covered all three documents at 390px and
1440px, including section navigation and document width. A separate screen
reader and keyboard audit is still needed before claiming accessibility quality.

## Fifth pass: purchase entry and line validation

The purchase form starts with one product line. Operators add or remove lines up
to the existing three-product limit, and the estimate follows the active lines.
The compact form uses the available desktop workspace and keeps its controls
readable on phones. A started line shows the missing fields beside that line;
every active line must be complete before the browser submits it. The web route
also rejects a partially filled sales or purchase line rather than silently
dropping it. This follows [SAP form validation guidance](https://experience.sap.com/fiori-design-web/form-field-validation/)
on showing errors where users can resolve them. Rendered browser checks covered
add/remove, focus, totals, incomplete and complete lines, and desktop/mobile
layout. Focused web-route checks covered partial-line rejection. Full contract
execution remains pending the fresh PostgreSQL test setup.

## Sixth pass: prevent duplicate order lines

The sales and purchase product selectors now disable products already chosen in
another line and label those options as already on the order. Add-line controls
stop when the available distinct catalog has been used; removing a line makes
its product available again. Empty catalogs and missing customer or supplier
records show the relevant setup links and disable submission. This applies the
error-prevention principle in [SAP form validation](https://experience.sap.com/fiori-design-web/form-field-validation/)
while preserving the server's duplicate-product checks. Browser checks covered
selection, removal, line limits, and empty setup states in both forms.

## Seventh pass: retain work after a rejected save

Sales and purchase order creation now re-renders the form with its customer or
supplier, product rows, quantities, and entered purchase costs when validation
or a service check rejects submission. An error is shown above the form; the
operator can correct it without rebuilding the order. Restored rows remain
subject to the same distinct-product picker and live estimate. This follows
[SAP form validation guidance](https://experience.sap.com/fiori-design-web/form-field-validation/)
on keeping corrective work in context. This is not yet a database-backed
end-to-end check; the PostgreSQL test database setup is still pending.

## Eighth pass: line-level review

Sales and purchase entry now show an estimated amount beside each line as well
as the overall estimate. Incomplete or invalid rows show a dash; changing a
quantity or purchase unit cost recalculates both the row and summary. The
pattern is informed by [Odoo quotation order lines](https://www.odoo.com/documentation/19.0/applications/sales/sales/sales_quotations/create_quotations.html),
without adding Odoo-specific quotation features. Rendered browser fixtures
checked restored two-line forms, edits, matching totals, and overflow at 1440px
and 390px. Mobile purchase entry was visually inspected. Database-backed
submission checks still depend on the PostgreSQL test setup.

## Ninth pass: master-data form recovery

Customer, supplier, and product creation now retain entered fields after a
rejected save. Validation and duplicate-record errors remain visible above the
form and, where the field is known, beside the field with an accessible error
association. This follows [SAP form validation guidance](https://experience.sap.com/fiori-design-web/form-field-validation/)
and keeps our small original customer, supplier, and catalog workflows. Focused
route and browser checks covered invalid submissions, retained values, inline
errors, and no phone-width overflow; the product form was visually inspected
at 390px. Duplicate-record service checks still need a fresh database fixture.

## Tenth pass: responsive analytics pie

The analytics pie now fits phone widths and has a separate, selectable legend
below the chart rather than SVG labels positioned for desktop. Longer periods
combine adjacent time buckets into at most five labeled shares; line and column
views retain their original bucket granularity. A single nonzero share renders
as a complete circle. Selecting a share shows its grouped invoiced and collected
amounts, and switching chart type clears stale selection. This follows
[Odoo graph guidance](https://www.odoo.com/documentation/19.0/applications/essentials/reporting.html)
on using pies for a small number of parts, while retaining the original
operational event definitions. Browser fixtures checked sparse and full
90-day charts, mode and measure switches, and overflow at 320px, 390px, and
1440px. The mobile result was visually inspected.

## Eleventh pass: readable daily analytics on phones

The analytics daily-detail table retains its four-column desktop layout. On
phones, each UTC date anchors a row with clearly labeled invoiced, collected,
and received-cost values below it, so no horizontal scan or clipped headers
are needed. The CSV export and underlying daily data are unchanged. This
applies the [SAP responsive-table principle](https://experience.sap.com/fiori-design-web/responsive-table/)
of keeping the identifying field visible while moving secondary values into
label/value details. Rendered browser fixtures checked all seven daily rows,
values, CSV link, layout, and overflow at 320px, 390px, and 1440px; the mobile
table was visually inspected.

## Twelfth pass: readable overview documents on phones

The recent sales and purchase order tables now use the same responsive row
pattern as analytics daily detail. At phone width, the customer or supplier
link stays prominent; stage, order value, and created date appear as labeled
details rather than squeezed columns. Desktop keeps the four-column tables.
This follows the identifying-field and label/value pattern in
[SAP responsive tables](https://experience.sap.com/fiori-design-web/responsive-table/)
without changing order data or navigation. Browser fixtures checked both
overview registers and the analytics table at 320px, 390px, and 1440px,
including values, links, and no page overflow; a mobile sales row was visually
inspected.

## Thirteenth pass: inventory movement clarity

The product movement ledger now labels its signed values as on-hand and
reserved *changes*, not balances. At phone width, the movement, note, and
reference remain the identifying content; the two deltas and timestamp appear
as labeled details. Desktop retains the table and right-aligned numeric
changes. This uses the [SAP responsive-table pattern](https://experience.sap.com/fiori-design-web/responsive-table/)
without changing inventory calculations. Browser fixtures checked labels,
values, layout, and overflow at 320px, 390px, and 1440px; the phone ledger was
visually inspected.

## Fourteenth pass: recover transaction-entry errors

Rejected invoice payments and manual stock additions now re-render their
detail pages with entered values intact instead of redirecting to a reset
form. Payment method and stock reason are retained. Amount/quantity errors
appear beside the affected field, and overpayment is expressed in dollars
using the refreshed outstanding balance. This follows
[SAP form validation guidance](https://experience.sap.com/fiori-design-web/form-field-validation/)
on corrective messages in context. The separate test repository's
`npm run test:erp-ui` checks the rendered failed-payment and stock forms at
390px and 1440px. These are render/browser fixtures; a database-backed
submission and concurrent-payment check remain separate acceptance gates.

## Fifteenth pass: related-record navigation

Customer sales history and supplier purchase history now use the order
reference as the direct link instead of a disconnected "View order" column.
Stage and creation date become labeled details on phones while desktop keeps
the compact table. The existing prefilled new-order actions remain in place.
This adapts the [SAP responsive-table pattern](https://experience.sap.com/fiori-design-web/responsive-table/)
of a linked identifier followed by secondary details, without copying its
visual design. `npm run test:erp-ui` verifies both related-record pages at
320px, 390px, and 1440px, including link targets and overflow. These are
render/browser checks, not database-backed workflow tests.

## Sixteenth pass: quieter, consistent registers

All six core registers now use their first-column record name as the sole
navigation link. Removing the duplicate trailing "View" column frees space
for business fields on desktop and avoids a second full-width action row on
phones. The primary link has a record-specific accessible name, while the new
last business field retains its visible mobile label. Search, filters, and
column/mobile sorting remain available. This follows the emphasis on useful
record lists and mobile-specific layouts in [SAP's table overview](https://experience.sap.com/fiori-design-web/table-overview/)
and the search/filter workflow described in [Odoo's search documentation](https://www.odoo.com/documentation/19.0/applications/essentials/search.html),
without reusing either product's branding. The separate `npm run test:erp-ui`
suite checks all six registers at 320px, 390px, and 1440px, including link
uniqueness, mobile labels, and the sales register's search, stage filter, and
sort. These are browser fixtures; server/database workflows remain a separate
gate.

## Seventeenth pass: truthful document indicators and navigation

Invoice payment progress now floors the display percentage rather than
rounding a partly paid invoice up to 100%. The visible progress description
and accessible value text use exact paid and total currency amounts, so a
one-cent outstanding balance is not described as fully paid. A received
purchase order no longer links its "stock ledger" action to only the first
product in a multi-line receipt. Its action leads to the received line items,
where each product links to its own movement ledger. This keeps the document
header action connected to the relevant section, as in [SAP's object-page
guidance](https://experience.sap.com/fiori-design-web/object-page/), and
acknowledges the product-specific movement history described in [Odoo's
inventory guidance](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/product_management/configure/type.html).
`npm run test:erp-ui` checks near-full/full invoice states and a two-product
receipt at 320px, 390px, and 1440px. No payment or inventory calculations in
the services/database were changed.

## Eighteenth pass: purchasing entry workspace

The purchase-order form now shares the sales-order entry hierarchy: a supplier
section, a line-entry section, and a compact review column that contains the
final create/cancel actions. Removing the outer card avoids a nested-card
appearance and keeps the estimate beside the fields on desktop, then after
the fields on phones. The sales and purchase account headings are shorter and
more task-specific at narrow widths. This adapts [SAP form guidance](https://experience.sap.com/fiori-design-web/explore_group/form-layout-container/)
to group related inputs and [action-placement guidance](https://experience.sap.com/fiori-design-web/action-placement/)
to keep the positive workflow action with its review context. It does not add
Odoo/SAP purchasing behavior. The separate `npm run test:erp-ui` suite checks
supplier and two-product entry, duplicate-product prevention, changing totals,
remove-line recalculation, empty-data gating, action placement, and overflow at
320px, 390px, and 1440px. Desktop and phone fixture screenshots were visually
inspected; database-backed submission remains a separate gate.

## Nineteenth pass: analytics layout and chart fit

Analytics now places its trend/daily detail and order/product context in two
columns on wide desktops, then stacks them below 1280px. The chart sizes to
its actual panel rather than assuming a 960px desktop canvas; dense phone
series can still scroll *inside* the chart, while pie mode stays within the
panel even after switching from a scrolled line view. This draws on [SAP's
responsive analytical-list guidance](https://experience.sap.com/fiori-design-web/analytical-list-page/)
for adapting chart/table content by viewport and [Odoo's dashboard guidance](https://www.odoo.com/documentation/19.0/applications/productivity/dashboards.html)
for keeping interactive charts alongside operational context, without copying
either product. `npm run test:erp-ui` checks the layout at 390px, 820px,
1280px, 1440px, and 1920px; columns, lines, pie, selected-interval figures,
and panel overflow. Desktop and phone fixture screenshots were visually
inspected. Analytics calculations and exports are unchanged.

## Twentieth pass: mobile workspace navigation

The mobile menu trigger now sits beside the brand in both visual and keyboard
order instead of dropping below the expanded links. Its name and expanded
state change together. Users can close it from the same button, with Escape,
or by clicking outside; crossing back to desktop also resets the menu state.
This adapts the open/close behavior described in [SAP's shell navigation
guidance](https://experience.sap.com/fiori-design-web/v1-40/shell-bar/)
without copying its shell. `npm run test:erp-ui` checks the menu at 390px and
820px, including trigger position, tab order, Escape focus return, outside
click, and resize. The open phone menu was visually inspected. Desktop
navigation and route destinations are unchanged.

## Twenty-first pass: clean document printing

Sales orders, purchase orders, and invoices now offer a browser Print action
from the document header. Print media removes workspace navigation, workflow
controls, tabs, error banners, and invoice payment-entry fields, while keeping
document facts, line tables, totals, and payment history. It restores compact
table columns even when printing from a phone-sized viewport and shows the
full record ID on paper. This is a modest document action inspired by the
object-page action area in [SAP's guidance](https://experience.sap.com/fiori-design-web/object-page/)
and the browser-print behavior documented for [Odoo receipts](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use/receipts.html);
it is not an Odoo-style report engine or a legally complete invoice.
`npm run test:erp-ui` checks the button trigger and print-media visibility for
all three documents at 390px and 1440px. The invoice layout was visually
inspected at an A4-like width. Actual printer/PDF pagination remains an
environment-specific check before external distribution.

## Twenty-second pass: account-form recovery

Rejected login and registration posts now re-render the form with non-secret
fields retained instead of redirecting to a blank page. Validation errors
appear beside the affected field, with focus directed to the first relevant
input; passwords are never re-populated. Existing successful redirects and
authentication services are unchanged. This applies the contextual error
pattern in [SAP's form validation guidance](https://experience.sap.com/fiori-design-web/form-field-validation/)
without adopting SAP account flows. `npm run test:erp-ui` checks login and
registration at 390px and 1440px, including retained values, password clearing,
field message association, and escaped input. An ephemeral Express smoke check
confirmed malformed POSTs return HTTP 400 with retained email and no password
in the response. A successful/duplicate-account database-backed run remains a
separate gate during the PostgreSQL migration. This does not address the
separate roadmap's public-registration/security policy decision.

## Twenty-third pass: explicit transaction confirmations

The shared confirmation dialog now names the action being confirmed in its
heading and final button rather than asking users to choose a generic
"Continue". Sales and purchase cancellation use a distinct destructive
confirm tone, while stock receipt, reservation, and manual adjustment retain
the standard action tone. The safe "Go back" action receives initial focus.
This follows the action-specific confirmation wording in [SAP's messaging
guidance](https://experience.sap.com/fiori-design-web/explore_group/messaging/)
without copying the component. `npm run test:erp-ui` checks sales, purchase,
and stock confirmation at 390px and 1440px, including title/button text,
destructive tone, safe dismissal by button/Escape, and acceptance resubmission.
The mobile cancellation dialog was visually inspected. These are client-side
interaction fixtures; transaction commits and authorization remain separate
database-backed/security gates.

## Twenty-fourth pass: site-wide visual audit

The sign-in page now has its own responsive entry layout. Shared navigation,
headings, buttons, fields, tables and status treatments use one consistent visual
system. The administrator's user-creation form has a two-column desktop layout.
The user directory now has labelled mobile rows and an empty state. The sales
order composer gives its line-item action a full row on narrow phones. Web
404 and unexpected error responses use a matching page; API errors remain JSON.

All 24 non-partial EJS page templates were rendered with representative data at
320px, 390px and 1440px in `test/scripts/ui/erp-page-audit.test.cjs`. The checks
cover horizontal overflow, visible page headings and browser script errors. The
existing `test:erp-ui` interaction suite passed 14 checks. A read-only local
runtime smoke check passed `/health`, `/ready`, login, the administrator's main
pages, and access/CSRF guards against the configured development database. No
data-changing transaction or production deployment was tested in this pass.

## Data rules

- Open sales = draft orders + confirmed orders without an invoice. Show invoiced
  orders as their own completed stage rather than leaving them "open."
- Sales-stage bar denominator = non-cancelled orders; segments distinguish
  Draft, Ready to ship, Partially shipped, Ready to invoice, and Invoiced. Label
  counts and percentages; show a neutral empty state when there are no orders.
- Stock meter = usable quantity (on-hand minus reserved) against the existing
  10-unit alert threshold. Zero/negative is critical, 1–4 warning, 5–9 watch.
  The threshold is a demo rule, not a per-product reorder policy.
- Analytics time-series uses daily buckets for 7 days and larger buckets for
  30/90 days. CSV export remains daily and unchanged. Cash received and invoices
  issued are independent event series; the chart does not imply profit.
- Product comparison bars are relative to the highest-ranked invoiced product,
  not a target-achievement measure. Every bar has its amount beside it.

## Showcase acceptance checks

1. At 1440px and 1920px, the dashboard fills the usable main area and does not
   present a tall empty companion panel or a row of floating cards.
2. Core actions, top risks and latest documents are visible near the first fold.
3. Progress bars are calculated from real records, remain bounded at 0–100%,
   use descriptive text, and render an honest empty state.
4. Analytics filters, CSV export, totals and charts agree. Existing reviewed
   browser/API contracts and build pass against a fresh database.
5. Sales, purchase and invoice details use one document pattern with operational
   actions visible in the header and line items readable without panel hopping.
6. Check signed-in desktop and mobile screenshots, keyboard focus, contrast,
   empty states and table overflow. Record unresolved gaps rather than calling
   the system production-ready.

## Explicitly out of this UI pass

Concurrency controls, audit logging, backup and recovery, hosted deployment,
and a full accounting model remain in the separate product roadmap. Role-based
authorization and CSRF guards have been added in the current worktree, but
their presence does not establish a complete security review or deployment
readiness. A strong showcase UI must not disguise those limitations.
