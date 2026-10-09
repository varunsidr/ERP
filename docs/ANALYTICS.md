# ERP operational analytics

Sign in and open `/analytics` for a live, read-only cockpit. The 7/30/90-day
selector uses UTC calendar days, including today. Invoiced value counts invoices
by creation date; collected value counts payments by posting date; received
purchase cost counts each receipt batch by its recorded date, including partial
deliveries. These events
can occur on different days and should not be subtracted to infer profit.

The invoicing/collections chart switches between Columns, Lines, Area, Pie,
and Donut. Pie and Donut show the selected measure's share across interval
groups; use their Invoiced/Collected control to change the measure. Select a
mark or legend item for its exact interval and values. Longer periods combine
adjacent buckets into at most five share groups. Charts remain read-only and
do not change the underlying transactions.

Open receivables, remaining ordered purchase commitments and low-stock alerts are
**current snapshots**, unaffected by the period selector. Receivables are
unpaid invoice amounts after payments and issued credit notes. Customer account
credits in excess of an invoice balance are shown on the customer and invoice
pages; they are not automatically applied to other invoices and do not represent
a cash refund. The overdue figure is the unpaid amount on invoices whose due date is before today. Due dates default to
30 days after issuance and can be set when an invoice is created. Ordered
commitments exclude draft purchase orders.
Stock alerts mean a product's available-minus-reserved quantity is below its
configured reorder point; a zero reorder point disables its alert. Product rankings
use invoiced line prices, not the current product price. This is operational
reporting, not a general ledger or financial statement.

## Power BI Desktop starter

1. Use **Export daily CSV** on `/analytics`, while signed in. The export contains
   `date_utc,invoiced_cents,collected_cents,received_cost_cents` and one row for
   every UTC date in the selected period, including zero-activity dates.
2. In Power BI Desktop, **Get data > Text/CSV** and load the downloaded file.
   Set `date_utc` to Date and the amount columns to Whole number. Create
   measures such as `Invoiced = DIVIDE(SUM(ERP[invoiced_cents]), 100)` after
   naming the imported table `ERP`; format as the app's demo currency.
3. Plot `date_utc` against invoiced and collected measures. Re-export and refresh
   to see new transactions. The file is a manual snapshot, not a live Power BI
   connection. Keep the export private because it contains business totals.

The separate test repository has a different [automation-run Power BI model](https://github.com/ashishbarthwal/ai-self-healing-test-automation-framework/blob/main/analytics/powerbi/README.md)
for test reliability and change coverage. Do not mix its run/test rows with the
ERP's business transactions without a deliberate semantic model.
