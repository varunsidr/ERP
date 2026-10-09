import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { increaseStock } from '../inventory/inventory.service';
import { recordAuditEvent } from '../audit/audit.service';
import type { CreateReturnInput } from './returns.types';

const returnInclude = {
  items: { include: { product: true, invoiceItem: true } },
  creditNote: true,
} as const;

export const createInvoiceReturn = async (
  invoiceId: string,
  idempotencyKey: string,
  input: CreateReturnInput,
  actorId: string,
) => prisma.$transaction(async tx => {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE
  `;
  if (!locked.length) throw notFound(`Invoice ${invoiceId} not found`);
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: { include: { product: true, returns: true } },
      payments: true,
      creditNotes: true,
    },
  });
  if (!invoice) throw notFound(`Invoice ${invoiceId} not found`);

  const normalizedItems = [...input.items].sort((a, b) => a.invoiceItemId.localeCompare(b.invoiceItemId));
  const requestHash = createHash('sha256').update(JSON.stringify({ reason: input.reason, items: normalizedItems })).digest('hex');
  const previous = await tx.customerReturn.findUnique({
    where: { invoiceId_idempotencyKey: { invoiceId, idempotencyKey } },
    include: returnInclude,
  });
  if (previous) {
    if (previous.requestHash !== requestHash) throw conflict('Idempotency key was already used for a different return');
    return previous;
  }

  const requestedById = new Map(input.items.map(item => [item.invoiceItemId, item]));
  let amountCents = 0;
  const returnLines = [];
  for (const item of invoice.items) {
    const requested = requestedById.get(item.id);
    if (!requested) continue;
    const alreadyReturned = item.returns.reduce((sum, returned) => sum + returned.quantity, 0);
    if (requested.quantity > item.quantity - alreadyReturned) {
      throw badRequest(`Return quantity for ${item.product.name} exceeds the remaining invoiced quantity`);
    }
    const lineAmount = requested.quantity * item.unitPriceCents;
    if (!Number.isSafeInteger(lineAmount) || amountCents + lineAmount > 2_147_483_647) {
      throw badRequest('Credit note total exceeds the supported amount');
    }
    amountCents += lineAmount;
    returnLines.push({
      invoiceItemId: item.id,
      productId: item.productId,
      productName: item.product.name,
      quantity: requested.quantity,
      resaleable: requested.resaleable,
    });
  }
  if (returnLines.length !== input.items.length) throw badRequest('One or more invoice lines do not belong to this invoice');

  const created = await tx.customerReturn.create({
    data: {
      invoiceId,
      reason: input.reason,
      amountCents,
      idempotencyKey,
      requestHash,
      items: { create: returnLines.map(({ productName: _productName, ...line }) => line) },
    },
    include: returnInclude,
  });
  await tx.creditNote.create({
    data: { invoiceId, returnId: created.id, amountCents },
  });

  for (const item of returnLines) {
    if (!item.resaleable) continue;
    await increaseStock(tx, item.productId, item.quantity, {
      type: 'RETURN_RESTOCK',
      referenceType: 'RETURN',
      referenceId: created.id,
      note: `Resaleable return: ${input.reason}`,
    });
  }

  const paymentsCents = invoice.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const existingCreditsCents = invoice.creditNotes.reduce((sum, credit) => sum + credit.amountCents, 0);
  if (invoice.totalCents > 0 && invoice.status === 'PENDING'
    && paymentsCents + existingCreditsCents + amountCents >= invoice.totalCents) {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'SETTLED', paidAt: new Date() } });
  }
  await recordAuditEvent(tx, {
    actorId,
    action: 'invoice.return_credited',
    entityType: 'Invoice',
    entityId: invoiceId,
    summary: `Recorded customer return and credit note of $${(amountCents / 100).toFixed(2)}`,
  });
  return tx.customerReturn.findUniqueOrThrow({ where: { id: created.id }, include: returnInclude });
});
