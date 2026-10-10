import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../lib/errors';
import type { CreateInvoiceInput, RecordPaymentInput } from './invoices.types';
import { invoiceDueAt } from './invoice.rules';
import { recordAuditEvent } from '../audit/audit.service';
import { shippedQuantitiesByOrderItem } from '../orders/order.rules';

const invoiceInclude = {
  items: { include: { product: true, returns: true } },
  payments: true,
  creditNotes: { include: { customerReturn: { include: { items: { include: { product: true } } } } } },
  order: { include: { customer: true } },
} as const;

export const listInvoices = () =>
  prisma.invoice.findMany({
    include: invoiceInclude,
    orderBy: { createdAt: 'desc' },
  });

export const getInvoice = async (id: string) => {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
  if (!invoice) {
    throw notFound(`Invoice ${id} not found`);
  }
  return invoice;
};

// Invoices are issued only after every ordered unit has been dispatched.
export const createInvoice = async (input: CreateInvoiceInput, actorId: string) => {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE
    `;
    if (!locked.length) throw notFound(`Order ${input.orderId} not found`);
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { items: true, invoice: true, shipments: { include: { items: true } } },
    });
    if (!order) throw notFound(`Order ${input.orderId} not found`);
    // The order is locked above, so a retry after a committed issuance can safely
    // return the existing invoice without consuming reserved stock or auditing twice.
    if (order.invoice) {
      const existingInvoice = await tx.invoice.findUnique({ where: { orderId: order.id }, include: invoiceInclude });
      if (!existingInvoice) throw notFound(`Invoice for order ${order.id} not found`);
      return existingInvoice;
    }
    if (order.status !== 'CONFIRMED') {
      throw badRequest(`Only CONFIRMED orders can be invoiced (current status: ${order.status})`);
    }
    const shippedByOrderItem = shippedQuantitiesByOrderItem(order);
    const notFullyShipped = order.items.some(item => (shippedByOrderItem.get(item.id) ?? 0) !== item.quantity);
    if (notFullyShipped) throw badRequest('Ship all ordered quantities before issuing the invoice');
    const totalCents = order.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);

    const invoice = await tx.invoice.create({
      data: {
        orderId: order.id,
        totalCents,
        dueAt: invoiceDueAt(input.dueDate),
        items: {
          create: order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
          })),
        },
      },
      include: invoiceInclude,
    });
    await recordAuditEvent(tx, { actorId, action: 'invoice.issued', entityType: 'Invoice', entityId: invoice.id,
      summary: `Issued invoice for sales order ${order.id}` });
    return invoice;
  });
};

// Payments accumulate against an invoice; once the sum reaches the total the invoice
// becomes PAID. Overpayment and payment against a non-PENDING invoice are rejected.
export const recordPayment = async (invoiceId: string, input: RecordPaymentInput, actorId: string) => {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE
    `;
    if (!locked.length) throw notFound(`Invoice ${invoiceId} not found`);
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: invoiceInclude });
    if (!invoice) throw notFound(`Invoice ${invoiceId} not found`);
    const method = input.method ?? 'manual';
    const retry = input.idempotencyKey
      ? invoice.payments.find((payment) => payment.idempotencyKey === input.idempotencyKey)
      : undefined;
    if (retry) {
      if (retry.amountCents !== input.amountCents || retry.method !== method) {
        throw conflict('Idempotency key was already used with different payment details');
      }
      return invoice;
    }
    if (invoice.status !== 'PENDING') {
      throw badRequest(`Only PENDING invoices accept payments (current status: ${invoice.status})`);
    }

    const alreadyPaid = invoice.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    const credited = invoice.creditNotes.reduce((sum, credit) => sum + credit.amountCents, 0);
    const newTotal = alreadyPaid + input.amountCents;
    if (newTotal + credited > invoice.totalCents) {
      throw badRequest(
        `Payment of ${input.amountCents} would exceed invoice total (outstanding: ${Math.max(0, invoice.totalCents - alreadyPaid - credited)})`,
      );
    }
    await tx.payment.create({
      data: { invoiceId, amountCents: input.amountCents, method, idempotencyKey: input.idempotencyKey ?? null },
    });

    const isFullyPaid = newTotal + credited >= invoice.totalCents;
    const updatedInvoice = await tx.invoice.update({
      where: { id: invoiceId },
      data: isFullyPaid ? { status: credited ? 'SETTLED' : 'PAID', paidAt: new Date() } : {},
      include: invoiceInclude,
    });
    await recordAuditEvent(tx, { actorId, action: 'invoice.payment_recorded', entityType: 'Invoice', entityId: invoiceId,
      summary: `Recorded payment of $${(input.amountCents / 100).toFixed(2)}${isFullyPaid ? ' and marked invoice paid' : ''}` });
    return updatedInvoice;
  });
};
