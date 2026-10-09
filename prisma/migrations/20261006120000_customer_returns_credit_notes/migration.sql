CREATE TABLE "CustomerReturn" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerReturn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "invoiceItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "resaleable" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerReturn_invoiceId_idempotencyKey_key"
    ON "CustomerReturn"("invoiceId", "idempotencyKey");
CREATE INDEX "CustomerReturn_invoiceId_createdAt_idx"
    ON "CustomerReturn"("invoiceId", "createdAt");
CREATE UNIQUE INDEX "ReturnItem_returnId_invoiceItemId_key"
    ON "ReturnItem"("returnId", "invoiceItemId");
CREATE INDEX "ReturnItem_invoiceItemId_idx" ON "ReturnItem"("invoiceItemId");
CREATE UNIQUE INDEX "CreditNote_returnId_key" ON "CreditNote"("returnId");
CREATE INDEX "CreditNote_invoiceId_createdAt_idx" ON "CreditNote"("invoiceId", "createdAt");

ALTER TABLE "CustomerReturn"
    ADD CONSTRAINT "CustomerReturn_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnItem"
    ADD CONSTRAINT "ReturnItem_returnId_fkey"
    FOREIGN KEY ("returnId") REFERENCES "CustomerReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReturnItem"
    ADD CONSTRAINT "ReturnItem_invoiceItemId_fkey"
    FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnItem"
    ADD CONSTRAINT "ReturnItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditNote"
    ADD CONSTRAINT "CreditNote_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditNote"
    ADD CONSTRAINT "CreditNote_returnId_fkey"
    FOREIGN KEY ("returnId") REFERENCES "CustomerReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerReturn"
    ADD CONSTRAINT "CustomerReturn_amountCents_nonnegative" CHECK ("amountCents" >= 0);
ALTER TABLE "ReturnItem"
    ADD CONSTRAINT "ReturnItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "CreditNote"
    ADD CONSTRAINT "CreditNote_amountCents_nonnegative" CHECK ("amountCents" >= 0);
