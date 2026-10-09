import assert from 'node:assert/strict';
import test from 'node:test';
import { receivableTotals } from '../src/modules/invoices/invoice.rules';
import { createReturnSchema, returnIdempotencyKeySchema } from '../src/modules/invoices/returns.types';
import { can } from '../src/lib/permissions';

test('return inputs require a reason and distinct positive quantities with a stock disposition', () => {
  const valid = { reason: 'Damaged packaging', items: [{ invoiceItemId: 'line-1', quantity: 2, resaleable: false }] };
  assert.equal(createReturnSchema.safeParse(valid).success, true);
  assert.equal(createReturnSchema.safeParse({ ...valid, reason: '  ' }).success, false);
  assert.equal(createReturnSchema.safeParse({ ...valid, items: [{ ...valid.items[0], quantity: 0 }] }).success, false);
  assert.equal(createReturnSchema.safeParse({ ...valid, items: [valid.items[0], valid.items[0]] }).success, false);
  assert.equal(returnIdempotencyKeySchema.safeParse('return-retry-1').success, true);
  assert.equal(returnIdempotencyKeySchema.safeParse('short').success, false);
});

test('return permission is granted to Sales and Admin but not read-only Staff', () => {
  assert.equal(can('SALES', 'returns.write'), true);
  assert.equal(can('ADMIN', 'returns.write'), true);
  assert.equal(can('STAFF', 'returns.write'), false);
  assert.equal(can('INVENTORY', 'returns.write'), false);
});

test('credit notes reduce receivables and excess credits become customer account credit', () => {
  const totals = receivableTotals([
    {
      dueAt: new Date('2026-10-05T00:00:00.000Z'),
      totalCents: 10_000,
      payments: [{ amountCents: 2_000 }],
      creditNotes: [{ amountCents: 3_000 }],
    },
    {
      dueAt: new Date('2026-10-05T00:00:00.000Z'),
      totalCents: 10_000,
      payments: [{ amountCents: 10_000 }],
      creditNotes: [{ amountCents: 2_500 }],
    },
  ], new Date('2026-10-06T00:00:00.000Z'));

  assert.deepEqual(totals, {
    invoiceCount: 1,
    outstandingCents: 5_000,
    overdueCents: 5_000,
    accountCreditCents: 2_500,
  });
});
