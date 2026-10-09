import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceDueAt, receivableTotals } from '../src/modules/invoices/invoice.rules';
import { createInvoiceSchema } from '../src/modules/invoices/invoices.types';

test('invoice due dates default to 30 days and overdue balances respect UTC due dates', () => {
  const issuedAt = new Date('2026-10-01T09:30:00.000Z');
  assert.equal(invoiceDueAt(undefined, issuedAt).getTime(), issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  assert.equal(invoiceDueAt('2026-10-14', issuedAt).toISOString(), '2026-10-14T00:00:00.000Z');
  assert.equal(createInvoiceSchema.safeParse({ orderId: 'order-1', dueDate: '2026-10-14' }).success, true);
  assert.equal(createInvoiceSchema.safeParse({ orderId: 'order-1', dueDate: '2026-02-30' }).success, false);

  const now = new Date('2026-10-01T16:00:00.000Z');
  const totals = receivableTotals([
    { dueAt: new Date('2026-09-30T00:00:00.000Z'), totalCents: 1000, payments: [{ amountCents: 400 }] },
    { dueAt: new Date('2026-10-01T00:00:00.000Z'), totalCents: 500, payments: [] },
    { dueAt: new Date('2026-09-01T00:00:00.000Z'), totalCents: 200, payments: [{ amountCents: 200 }] },
  ], now);
  assert.deepEqual(totals, { invoiceCount: 2, outstandingCents: 1100, overdueCents: 600, accountCreditCents: 0 });
});
