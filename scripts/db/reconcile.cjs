const { PrismaClient } = require('@prisma/client');
require('dotenv/config');

const prisma = new PrismaClient();

const runChecks = async (tx) => {
  const checks = [];
  const check = async (name, query) => {
    const [row] = await query;
    checks.push({ name, violations: Number(row.violations) });
  };

  await check('every product has an inventory record', tx.$queryRaw`
    SELECT COUNT(*)::int AS violations
    FROM "Product" p LEFT JOIN "InventoryItem" i ON i."productId" = p.id
    WHERE i.id IS NULL
  `);

  await check('reserved stock equals confirmed unbilled sales lines', tx.$queryRaw`
    WITH shipped AS (
      SELECT si."orderItemId", SUM(si.quantity)::bigint AS quantity
      FROM "ShipmentItem" si
      GROUP BY si."orderItemId"
    ), expected AS (
      SELECT oi."productId", SUM(oi.quantity - COALESCE(s.quantity, 0))::int AS quantity
      FROM "Order" o
      JOIN "OrderItem" oi ON oi."orderId" = o.id
      LEFT JOIN shipped s ON s."orderItemId" = oi.id
      WHERE o.status = 'CONFIRMED'
        AND NOT EXISTS (SELECT 1 FROM "Invoice" inv WHERE inv."orderId" = o.id)
      GROUP BY oi."productId"
    )
    SELECT COUNT(*)::int AS violations
    FROM "InventoryItem" i
    LEFT JOIN expected e ON e."productId" = i."productId"
    WHERE i."reservedQty" <> COALESCE(e.quantity, 0)
  `);

  await check('invoice totals and payment status match their detail rows', tx.$queryRaw`
    SELECT COUNT(*)::int AS violations
    FROM "Invoice" i
    LEFT JOIN LATERAL (
      SELECT SUM(ii.quantity::bigint * ii."unitPriceCents") AS cents
      FROM "InvoiceItem" ii WHERE ii."invoiceId" = i.id
    ) lines ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(p."amountCents") AS cents
      FROM "Payment" p WHERE p."invoiceId" = i.id
    ) payments ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(cn."amountCents") AS cents
      FROM "CreditNote" cn WHERE cn."invoiceId" = i.id
    ) credits ON TRUE
    WHERE i."totalCents" <> COALESCE(lines.cents, 0)
      OR COALESCE(payments.cents, 0) > i."totalCents"
      OR (i.status = 'PAID' AND COALESCE(payments.cents, 0) <> i."totalCents")
      OR (i.status = 'PENDING' AND i."totalCents" > 0
        AND COALESCE(payments.cents, 0) + COALESCE(credits.cents, 0) >= i."totalCents")
      OR (i.status = 'SETTLED' AND COALESCE(payments.cents, 0) + COALESCE(credits.cents, 0) < i."totalCents")
      OR (i.status = 'SETTLED' AND COALESCE(credits.cents, 0) = 0)
      OR i.status NOT IN ('PENDING', 'PAID', 'SETTLED')
  `);

  await check('invoice lines preserve their sales-order price and quantities', tx.$queryRaw`
    WITH order_lines AS (
      SELECT inv.id AS "invoiceId", oi."productId", oi.quantity, oi."unitPriceCents"
      FROM "Invoice" inv JOIN "OrderItem" oi ON oi."orderId" = inv."orderId"
    ), invoice_lines AS (
      SELECT ii."invoiceId", ii."productId", ii.quantity, ii."unitPriceCents"
      FROM "InvoiceItem" ii
    )
    SELECT COUNT(*)::int AS violations
    FROM order_lines o FULL OUTER JOIN invoice_lines i
      ON i."invoiceId" = o."invoiceId" AND i."productId" = o."productId"
    WHERE o."productId" IS NULL OR i."productId" IS NULL
      OR o.quantity IS DISTINCT FROM i.quantity
      OR o."unitPriceCents" IS DISTINCT FROM i."unitPriceCents"
  `);

  await check('purchase receipt movements match received order lines', tx.$queryRaw`
    WITH expected AS (
      SELECT poi."purchaseOrderId", poi."productId",
        SUM(poi."receivedQty")::bigint AS quantity
      FROM "PurchaseOrder" po
      JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id
      GROUP BY poi."purchaseOrderId", poi."productId"
    ), actual AS (
      SELECT im."referenceId" AS "purchaseOrderId", im."productId",
        SUM(im."quantityDelta")::bigint AS quantity, SUM(im."reservedDelta")::bigint AS reserved
      FROM "InventoryMovement" im
      WHERE im.type = 'PURCHASE_RECEIPT' AND im."referenceType" = 'PURCHASE_ORDER'
      GROUP BY im."referenceId", im."productId"
    )
    SELECT COUNT(*)::int AS violations
    FROM expected e FULL OUTER JOIN actual a
      ON a."purchaseOrderId" = e."purchaseOrderId" AND a."productId" = e."productId"
    WHERE COALESCE(e.quantity, 0) <> COALESCE(a.quantity, 0)
      OR COALESCE(a.reserved, 0) <> 0
  `);

  await check('purchase receipt batches match received quantities and statuses', tx.$queryRaw`
    WITH batched AS (
      SELECT pri."purchaseOrderItemId", SUM(pri.quantity)::bigint AS quantity
      FROM "PurchaseReceiptItem" pri
      GROUP BY pri."purchaseOrderItemId"
    )
    SELECT COUNT(*)::int AS violations
    FROM "PurchaseOrderItem" poi
    JOIN "PurchaseOrder" po ON po.id = poi."purchaseOrderId"
    LEFT JOIN batched b ON b."purchaseOrderItemId" = poi.id
    WHERE COALESCE(b.quantity, 0) <> poi."receivedQty"
      OR poi."receivedQty" < 0 OR poi."receivedQty" > poi.quantity
      OR (po.status = 'RECEIVED' AND poi."receivedQty" <> poi.quantity)
      OR (po.status = 'ORDERED' AND poi."receivedQty" <> 0)
      OR (po.status = 'RECEIVED' AND po."receivedAt" IS NULL)
      OR (po.status = 'PARTIALLY_RECEIVED' AND po."receivedAt" IS NOT NULL)
  `);

  await check('purchase order status matches aggregate received quantities', tx.$queryRaw`
    SELECT COUNT(*)::int AS violations
    FROM (
      SELECT po.id, po.status, SUM(poi.quantity)::bigint AS ordered,
        SUM(poi."receivedQty")::bigint AS received
      FROM "PurchaseOrder" po
      JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id
      GROUP BY po.id, po.status
    ) totals
    WHERE (status = 'ORDERED' AND received <> 0)
      OR (status = 'PARTIALLY_RECEIVED' AND (received = 0 OR received >= ordered))
      OR (status = 'RECEIVED' AND received <> ordered)
  `);

  await check('purchase receipt lines belong to their parent purchase order', tx.$queryRaw`
    SELECT COUNT(*)::int AS violations
    FROM "PurchaseReceiptItem" pri
    JOIN "PurchaseReceipt" receipt ON receipt.id = pri."receiptId"
    JOIN "PurchaseOrderItem" poi ON poi.id = pri."purchaseOrderItemId"
    WHERE receipt."purchaseOrderId" <> poi."purchaseOrderId"
  `);

  await check('legacy sale consumption movements match invoiced lines', tx.$queryRaw`
    WITH expected AS (
      SELECT inv."orderId", ii."productId", SUM(ii.quantity)::bigint AS quantity
      FROM "Invoice" inv
      JOIN "Shipment" s ON s."orderId" = inv."orderId" AND s."requestHash" = 'legacy'
      JOIN "InvoiceItem" ii ON ii."invoiceId" = inv.id
      GROUP BY inv."orderId", ii."productId"
    ), actual AS (
      SELECT im."referenceId" AS "orderId", im."productId",
        SUM(im."quantityDelta")::bigint AS quantity, SUM(im."reservedDelta")::bigint AS reserved
      FROM "InventoryMovement" im
      WHERE im.type = 'SALE_CONSUMPTION' AND im."referenceType" = 'ORDER'
      GROUP BY im."referenceId", im."productId"
    )
    SELECT COUNT(*)::int AS violations
    FROM expected e FULL OUTER JOIN actual a
      ON a."orderId" = e."orderId" AND a."productId" = e."productId"
    WHERE COALESCE(e.quantity, 0) <> -COALESCE(a.quantity, 0)
      OR COALESCE(e.quantity, 0) <> -COALESCE(a.reserved, 0)
  `);

  await check('shipment consumption movements match dispatched quantities', tx.$queryRaw`
    WITH expected AS (
      SELECT s.id AS "shipmentId", oi."productId", SUM(si.quantity)::bigint AS quantity
      FROM "Shipment" s
      JOIN "ShipmentItem" si ON si."shipmentId" = s.id
      JOIN "OrderItem" oi ON oi.id = si."orderItemId"
      WHERE s."requestHash" <> 'legacy'
      GROUP BY s.id, oi."productId"
    ), actual AS (
      SELECT im."referenceId" AS "shipmentId", im."productId",
        SUM(im."quantityDelta")::bigint AS quantity, SUM(im."reservedDelta")::bigint AS reserved
      FROM "InventoryMovement" im
      WHERE im.type = 'SALE_CONSUMPTION' AND im."referenceType" = 'SHIPMENT'
      GROUP BY im."referenceId", im."productId"
    )
    SELECT COUNT(*)::int AS violations
    FROM expected e FULL OUTER JOIN actual a
      ON a."shipmentId" = e."shipmentId" AND a."productId" = e."productId"
    WHERE COALESCE(e.quantity, 0) <> -COALESCE(a.quantity, 0)
      OR COALESCE(e.quantity, 0) <> -COALESCE(a.reserved, 0)
  `);

  await check('shipment quantities belong to the order and do not exceed ordered units', tx.$queryRaw`
    WITH shipped AS (
      SELECT si."orderItemId", SUM(si.quantity)::bigint AS quantity
      FROM "ShipmentItem" si
      GROUP BY si."orderItemId"
    )
    SELECT (
      SELECT COUNT(*)::int
      FROM "ShipmentItem" si
      JOIN "Shipment" s ON s.id = si."shipmentId"
      JOIN "OrderItem" oi ON oi.id = si."orderItemId"
      WHERE s."orderId" <> oi."orderId"
    ) + (
      SELECT COUNT(*)::int
      FROM shipped s
      JOIN "OrderItem" oi ON oi.id = s."orderItemId"
      WHERE s.quantity > oi.quantity
    ) AS violations
  `);

  await check('shipments contain lines and are not attached to cancelled orders', tx.$queryRaw`
    SELECT (
      SELECT COUNT(*)::int
      FROM "Shipment" s
      WHERE NOT EXISTS (SELECT 1 FROM "ShipmentItem" si WHERE si."shipmentId" = s.id)
    ) + (
      SELECT COUNT(*)::int
      FROM "Shipment" s
      JOIN "Order" o ON o.id = s."orderId"
      WHERE o.status = 'CANCELLED'
    ) AS violations
  `);

  await check('invoices are issued only after all ordered quantities are shipped', tx.$queryRaw`
    WITH shipped AS (
      SELECT si."orderItemId", SUM(si.quantity)::bigint AS quantity
      FROM "ShipmentItem" si
      GROUP BY si."orderItemId"
    )
    SELECT COUNT(*)::int AS violations
    FROM "Invoice" i
    JOIN "OrderItem" oi ON oi."orderId" = i."orderId"
    LEFT JOIN shipped s ON s."orderItemId" = oi.id
    WHERE COALESCE(s.quantity, 0) <> oi.quantity
  `);

  await check('customer returns and credit notes match invoiced quantities and snapshots', tx.$queryRaw`
    WITH returned AS (
      SELECT ri."invoiceItemId", SUM(ri.quantity)::bigint AS quantity
      FROM "ReturnItem" ri
      GROUP BY ri."invoiceItemId"
    ), return_amounts AS (
      SELECT cr.id AS "returnId", cr."invoiceId",
        SUM(ri.quantity * ii."unitPriceCents")::bigint AS amount,
        COUNT(ri.id)::int AS item_count,
        BOOL_AND(ri."productId" = ii."productId" AND ii."invoiceId" = cr."invoiceId") AS references_match
      FROM "CustomerReturn" cr
      JOIN "ReturnItem" ri ON ri."returnId" = cr.id
      JOIN "InvoiceItem" ii ON ii.id = ri."invoiceItemId"
      GROUP BY cr.id, cr."invoiceId"
    )
    SELECT COUNT(*)::int AS violations
    FROM "CustomerReturn" cr
    LEFT JOIN return_amounts ra ON ra."returnId" = cr.id
    LEFT JOIN "CreditNote" cn ON cn."returnId" = cr.id
    WHERE COALESCE(ra.item_count, 0) = 0
      OR COALESCE(ra.references_match, false) = false
      OR cr."amountCents" <> COALESCE(ra.amount, 0)
      OR cn.id IS NULL
      OR cn."invoiceId" <> cr."invoiceId"
      OR cn."amountCents" <> cr."amountCents"
    UNION ALL
    SELECT COUNT(*)::int AS violations
    FROM returned r
    JOIN "InvoiceItem" ii ON ii.id = r."invoiceItemId"
    WHERE r.quantity > ii.quantity
  `);

  await check('resaleable return movements match credited return lines', tx.$queryRaw`
    WITH expected AS (
      SELECT ri."returnId", ri."productId", SUM(ri.quantity)::bigint AS quantity
      FROM "ReturnItem" ri
      WHERE ri.resaleable = true
      GROUP BY ri."returnId", ri."productId"
    ), actual AS (
      SELECT im."referenceId" AS "returnId", im."productId",
        SUM(im."quantityDelta")::bigint AS quantity, SUM(im."reservedDelta")::bigint AS reserved
      FROM "InventoryMovement" im
      WHERE im.type = 'RETURN_RESTOCK' AND im."referenceType" = 'RETURN'
      GROUP BY im."referenceId", im."productId"
    )
    SELECT COUNT(*)::int AS violations
    FROM expected e FULL OUTER JOIN actual a
      ON a."returnId" = e."returnId" AND a."productId" = e."productId"
    WHERE COALESCE(e.quantity, 0) <> COALESCE(a.quantity, 0)
      OR COALESCE(a.reserved, 0) <> 0
  `);

  await check('reservation movements match sales-order state', tx.$queryRaw`
    WITH expected AS (
      SELECT o.id AS "orderId", oi."productId",
        SUM(CASE WHEN o.status = 'CONFIRMED'
          AND NOT EXISTS (SELECT 1 FROM "Invoice" inv WHERE inv."orderId" = o.id)
          THEN oi.quantity ELSE 0 END)::bigint AS quantity
      FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id
      GROUP BY o.id, oi."productId"
    ), actual AS (
      SELECT CASE
          WHEN im."referenceType" = 'SHIPMENT' THEN s."orderId"
          ELSE im."referenceId"
        END AS "orderId", im."productId",
        SUM(im."reservedDelta")::bigint AS quantity
      FROM "InventoryMovement" im
      LEFT JOIN "Shipment" s ON im."referenceType" = 'SHIPMENT' AND s.id = im."referenceId"
      WHERE im."referenceType" IN ('ORDER', 'SHIPMENT')
      GROUP BY CASE
          WHEN im."referenceType" = 'SHIPMENT' THEN s."orderId"
          ELSE im."referenceId"
        END, im."productId"
    )
    SELECT COUNT(*)::int AS violations
    FROM expected e FULL OUTER JOIN actual a
      ON a."orderId" = e."orderId" AND a."productId" = e."productId"
    WHERE COALESCE(e.quantity, 0) <> COALESCE(a.quantity, 0)
  `);

  return checks;
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set to run read-only reconciliation');
  const checks = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return runChecks(tx);
  }, { maxWait: 10_000, timeout: 60_000 });

  let failures = 0;
  for (const result of checks) {
    if (!Number.isSafeInteger(result.violations) || result.violations < 0) {
      throw new Error(`Invalid violation count returned for ${result.name}`);
    }
    if (result.violations) failures++;
    process.stdout.write(`${result.violations ? 'FAIL' : 'PASS'} ${result.name}${result.violations ? ` (${result.violations} mismatches)` : ''}\n`);
  }
  process.stdout.write(`${checks.length - failures}/${checks.length} reconciliation checks passed.\n`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((error) => {
    process.stderr.write(`Reconciliation failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
