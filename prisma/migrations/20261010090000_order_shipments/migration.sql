CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Shipment_orderId_idempotencyKey_key"
    ON "Shipment"("orderId", "idempotencyKey");
CREATE INDEX "Shipment_orderId_dispatchedAt_idx"
    ON "Shipment"("orderId", "dispatchedAt");
CREATE UNIQUE INDEX "ShipmentItem_shipmentId_orderItemId_key"
    ON "ShipmentItem"("shipmentId", "orderItemId");
CREATE INDEX "ShipmentItem_orderItemId_idx" ON "ShipmentItem"("orderItemId");

ALTER TABLE "Shipment"
    ADD CONSTRAINT "Shipment_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentItem"
    ADD CONSTRAINT "ShipmentItem_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShipmentItem"
    ADD CONSTRAINT "ShipmentItem_orderItemId_fkey"
    FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentItem"
    ADD CONSTRAINT "ShipmentItem_quantity_positive" CHECK ("quantity" > 0);

INSERT INTO "Shipment" ("id", "orderId", "idempotencyKey", "requestHash", "dispatchedAt", "createdAt")
SELECT 'legacy-shipment-' || i.id, i."orderId", 'legacy-invoice-' || i.id, 'legacy', i."createdAt", i."createdAt"
FROM "Invoice" i;

INSERT INTO "ShipmentItem" ("id", "shipmentId", "orderItemId", "quantity")
SELECT 'legacy-shipment-item-' || oi.id, 'legacy-shipment-' || i.id, oi.id, oi.quantity
FROM "Invoice" i
JOIN "OrderItem" oi ON oi."orderId" = i."orderId";
