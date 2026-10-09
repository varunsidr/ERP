import { Router } from 'express';
import type { RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { clearOutboxEmails, listOutboxEmails } from '../lib/email-outbox';
import { testSupportTokenMatches } from '../lib/test-support';
import { resolveSeedPassword, seedBaseline } from '../lib/seed-baseline';

const requireToken: RequestHandler = (req, res, next) => {
  if (!testSupportTokenMatches(req.get('x-erp-test-token'))) {
    return res.status(404).json({ error: 'Route not found' });
  }
  next();
};

export const testSupportRouter = Router();
testSupportRouter.use(requireToken);

// Wipes all business data and sign-in state, then restores the deterministic baseline.
testSupportRouter.post('/reset', async (req, res, next) => {
  try {
    const roleUsers = req.body?.roleUsers === true;
    const password = resolveSeedPassword();
    await prisma.$transaction([
      prisma.accountActionToken.deleteMany(),
      prisma.auditEvent.deleteMany(),
      prisma.purchaseReceiptItem.deleteMany(),
      prisma.purchaseReceipt.deleteMany(),
      prisma.purchaseOrderItem.deleteMany(),
      prisma.purchaseOrder.deleteMany(),
      prisma.payment.deleteMany(),
      prisma.creditNote.deleteMany(),
      prisma.returnItem.deleteMany(),
      prisma.customerReturn.deleteMany(),
      prisma.invoiceItem.deleteMany(),
      prisma.invoice.deleteMany(),
      prisma.orderItem.deleteMany(),
      prisma.order.deleteMany(),
      prisma.inventoryMovement.deleteMany(),
      prisma.inventoryItem.deleteMany(),
      prisma.product.deleteMany(),
      prisma.customer.deleteMany(),
      prisma.supplier.deleteMany(),
      prisma.rateLimitBucket.deleteMany(),
      prisma.user.deleteMany(),
    ]);
    clearOutboxEmails();
    const seeded = await seedBaseline(prisma, password, { roleUsers });
    res.json({ status: 'reset', seeded, roleUsers });
  } catch (error) { next(error); }
});

testSupportRouter.get('/emails', (req, res) => {
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  res.json({ emails: listOutboxEmails(to) });
});

testSupportRouter.delete('/emails', (_req, res) => {
  clearOutboxEmails();
  res.status(204).end();
});