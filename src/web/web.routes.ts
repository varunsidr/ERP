import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { ZodError } from 'zod';
import { AppError, badRequest } from '../lib/errors';
import { requireWebAuth, requireWebPermission } from './web.middleware';
import { setSessionCookie, clearSessionCookie } from './web.middleware';
import { approveUserSchema, changePasswordSchema, changeUserRoleSchema, emailRequestSchema, loginSchema, registerSchema, resetPasswordSchema, setUserActiveSchema, signupSchema } from '../modules/auth/auth.types';
import { approveUser, changePassword, changeUserRole, getCurrentUser, loginUser, registerUser, requestPasswordReset, resetPassword, resendEmailVerification, setUserActive, signupUser, verifyAccountEmail } from '../modules/auth/auth.service';
import { createCustomerSchema } from '../modules/customers/customers.types';
import { createCustomer, getCustomer, listCustomers } from '../modules/customers/customers.service';
import { createProductSchema, updateReorderPointSchema } from '../modules/products/products.types';
import { createProduct, getProduct, listProducts, updateProductReorderPoint } from '../modules/products/products.service';
import { adjustStock } from '../modules/inventory/inventory.service';
import { adjustStockSchema, stockIdempotencyKeySchema } from '../modules/inventory/inventory.types';
import { createOrderSchema } from '../modules/orders/orders.types';
import { cancelOrder, confirmOrder, createOrder, getOrder, listOrders } from '../modules/orders/orders.service';
import { createInvoiceSchema, recordPaymentSchema } from '../modules/invoices/invoices.types';
import { createInvoice, getInvoice, listInvoices, recordPayment } from '../modules/invoices/invoices.service';
import { createInvoiceReturn } from '../modules/invoices/returns.service';
import { createReturnSchema, returnIdempotencyKeySchema } from '../modules/invoices/returns.types';
import { createSupplierSchema } from '../modules/suppliers/suppliers.types';
import { createSupplier, getSupplier, listSuppliers } from '../modules/suppliers/suppliers.service';
import { createPurchaseOrderSchema, idempotencyKeySchema, receivePurchaseOrderSchema } from '../modules/purchasing/purchasing.types';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  receivePurchaseOrder,
  submitPurchaseOrder,
} from '../modules/purchasing/purchasing.service';
import { analyticsCsv, getAnalytics, parseAnalyticsPeriod } from '../modules/analytics/analytics.service';
import { prisma } from '../lib/prisma';
import { loginAttemptLimiter, passwordResetAttemptLimiter, rateLimitMiddleware, signupAttemptLimiter } from '../middleware/ip-rate-limit';
import { accountEmailDisabled } from '../lib/account-email';

export const webViewsPath = path.join(__dirname, 'views');

export const webRouter = Router();

const emailAccountPaths = new Set([
  '/signup', '/signup/success', '/verify-email', '/verify-email/resend', '/forgot-password', '/reset-password',
]);
webRouter.use((req, res, next) => {
  res.locals.accountEmailEnabled = !accountEmailDisabled();
  if (!res.locals.accountEmailEnabled && emailAccountPaths.has(req.path.toLowerCase().replace(/\/+$/, ''))) {
    return res.status(503).render('system-error', {
      pageTitle: 'Account requests unavailable', errorCode: '503', errorTitle: 'Account requests unavailable',
      errorDescription: 'New accounts and email recovery are unavailable in this demo. Sign in with an account supplied by the administrator.',
    });
  }
  next();
});

const errorMessage = (err: unknown) => {
  if (err instanceof AppError) return err.message;
  if (err instanceof ZodError) return err.issues.map((issue) => issue.message).join(', ');
  return 'Something went wrong';
};

const textDraft = (body: Record<string, unknown> | undefined, fields: string[]) =>
  Object.fromEntries(fields.map((field) => {
    const value = body?.[field];
    return [field, typeof value === 'string' || typeof value === 'number' ? String(value) : ''];
  }));

const formFieldErrors = (err: unknown, conflictField: string, allowedFields: string[], aliases: Record<string, string> = {}) => {
  if (err instanceof AppError && err.statusCode === 409) return { [conflictField]: err.message };
  if (err instanceof ZodError) {
    return Object.fromEntries(err.issues.flatMap((issue) => {
      const key = String(issue.path[0] ?? '');
      const field = aliases[key] ?? key;
      return allowedFields.includes(field) ? [[field, issue.message]] : [];
    }));
  }
  return {};
};

const formErrorStatus = (err: unknown) => err instanceof AppError ? err.statusCode : err instanceof ZodError ? 400 : 500;

const draftItems = (rawItems: unknown, limit: number) => {
  const values = Array.isArray(rawItems)
    ? rawItems
    : rawItems && typeof rawItems === 'object' ? Object.values(rawItems) : [];
  const items = values.slice(0, limit).map((raw: any) => ({
    productId: String(raw?.productId ?? ''),
    quantity: String(raw?.quantity ?? ''),
    unitCostDollars: String(raw?.unitCostDollars ?? ''),
  }));
  return items.length ? items : [{ productId: '', quantity: '', unitCostDollars: '' }];
};

// Form bodies submit numbers/arrays as strings; this coerces the raw `items[i][...]`
// shape express.urlencoded produces into the typed input the order service expects.
const parseOrderItems = (rawItems: unknown): { productId: string; quantity: number }[] => {
  const list = Array.isArray(rawItems) ? rawItems : Object.values(rawItems ?? {});
  return list.flatMap((raw: any, index) => {
    const productId = String(raw?.productId ?? '').trim();
    const quantity = String(raw?.quantity ?? '').trim();
    if (!productId && !quantity) return [];
    if (!productId || !quantity) throw badRequest(`Complete product and quantity for line ${index + 1}`);
    return [{ productId, quantity: Number(quantity) }];
  });
};

const parseMoneyDollarsToCents = (value: unknown, label: string): number => {
  const amount = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw badRequest(`Enter a ${label} with no more than two decimal places`);
  const [dollars, fraction = ''] = amount.split('.');
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0) throw badRequest(`Enter a valid ${label}`);
  return cents;
};

const parsePurchaseOrderItems = (
  rawItems: unknown,
): { productId: string; quantity: number; unitCostCents: number }[] => {
  const list = Array.isArray(rawItems) ? rawItems : Object.values(rawItems ?? {});
  return list.flatMap((raw: any, index) => {
    const productId = String(raw?.productId ?? '').trim();
    const quantity = String(raw?.quantity ?? '').trim();
    const unitCostDollars = String(raw?.unitCostDollars ?? '').trim();
    const unitCostCents = String(raw?.unitCostCents ?? '').trim();
    if (!productId && !quantity && !unitCostDollars && !unitCostCents) return [];
    if (!productId || !quantity || (!unitCostDollars && !unitCostCents)) {
      throw badRequest(`Complete product, quantity, and unit cost for line ${index + 1}`);
    }
    return [{
      productId,
      quantity: Number(quantity),
      unitCostCents: unitCostDollars
        ? parseMoneyDollarsToCents(unitCostDollars, 'unit cost')
        : Number(unitCostCents),
    }];
  });
};

const parseDollarsToCents = (value: unknown): number => {
  const amount = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw badRequest('Enter a payment amount with no more than two decimal places');
  const [dollars, fraction = ''] = amount.split('.');
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw badRequest('Enter a positive payment amount');
  return cents;
};

const parseReturnItems = (rawItems: unknown) => {
  const values = Array.isArray(rawItems)
    ? rawItems
    : rawItems && typeof rawItems === 'object' ? Object.values(rawItems) : [];
  return values.flatMap((raw) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const quantity = String(item.quantity ?? '').trim();
    if (!quantity || quantity === '0') return [];
    return [{
      invoiceItemId: String(item.invoiceItemId ?? ''),
      quantity: Number(quantity),
      resaleable: item.resaleable === 'true',
    }];
  });
};

webRouter.get('/', (req, res) => res.redirect(req.user ? '/dashboard' : '/login'));

webRouter.get('/login', (req, res) => {
  res.render('login', { error: req.query.error, message: req.query.message, loginDraft: { email: '' }, loginFieldErrors: {} });
});

webRouter.post('/login', rateLimitMiddleware(loginAttemptLimiter, (_req, res, retryAfterSeconds) => {
  res.status(429).render('login', {
    error: `Too many sign-in attempts. Try again in ${retryAfterSeconds} seconds.`,
    loginDraft: { email: '' }, loginFieldErrors: {},
  });
}), async (req, res) => {
  try {
    const input = loginSchema.parse(req.body);
    const { token } = await loginUser(input);
    setSessionCookie(res, token);
    res.redirect('/dashboard');
  } catch (err) {
    res.status(formErrorStatus(err)).render('login', {
      error: errorMessage(err),
      loginDraft: textDraft(req.body, ['email']),
      loginFieldErrors: formFieldErrors(err, 'email', ['email', 'password']),
    });
  }
});

webRouter.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('signup', { signupDraft: { name: '', email: '' }, signupFieldErrors: {}, error: '' });
});

webRouter.post('/signup', rateLimitMiddleware(signupAttemptLimiter, (_req, res, retryAfterSeconds) => {
  res.status(429).render('signup', {
    error: `Too many account requests. Try again in ${retryAfterSeconds} seconds.`,
    signupDraft: { name: '', email: '' }, signupFieldErrors: {},
  });
}), async (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  try {
    await signupUser(signupSchema.parse(req.body));
    res.redirect('/signup/success');
  } catch (err) {
    res.status(formErrorStatus(err)).render('signup', {
      error: errorMessage(err),
      signupDraft: textDraft(req.body, ['name', 'email']),
      signupFieldErrors: formFieldErrors(err, 'email', ['name', 'email', 'password', 'confirmPassword']),
    });
  }
});

webRouter.get('/signup/success', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('signup-success');
});

webRouter.post('/verify-email/resend', rateLimitMiddleware(signupAttemptLimiter), async (req, res) => {
  const input = emailRequestSchema.safeParse(req.body);
  if (input.success) {
    try { await resendEmailVerification(input.data.email); }
    catch { console.error('Email verification request could not be processed'); }
  }
  res.redirect('/signup/success?sent=1');
});

webRouter.get('/verify-email', (req, res) => {
  res.render('verify-email', {
    token: typeof req.query.token === 'string' ? req.query.token : '', verified: false, attempted: false, error: '',
  });
});

webRouter.post('/verify-email', async (req, res) => {
  try {
    await verifyAccountEmail(typeof req.body?.token === 'string' ? req.body.token : '');
    return res.render('verify-email', { token: '', verified: true, attempted: true, error: '' });
  } catch (err) {
    const serviceFailure = !(err instanceof AppError);
    if (serviceFailure) console.error('Email verification could not be completed');
    return res.status(serviceFailure ? 503 : 400).render('verify-email', {
      token: typeof req.body?.token === 'string' ? req.body.token : '', verified: false, attempted: true,
      error: serviceFailure ? 'Email verification is temporarily unavailable. Try again shortly.' : 'This verification link is invalid or expired. Request a new one below.',
    });
  }
});

webRouter.get('/forgot-password', (req, res) => res.render('forgot-password', { sent: req.query.sent === '1' }));

webRouter.post('/forgot-password', rateLimitMiddleware(passwordResetAttemptLimiter), async (req, res) => {
  const startedAt = Date.now();
  const input = emailRequestSchema.safeParse(req.body);
  if (input.success) {
    try { await requestPasswordReset(input.data.email); }
    catch { console.error('Password recovery request could not be processed'); }
  }
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 250 - (Date.now() - startedAt))));
  res.redirect('/forgot-password?sent=1');
});

webRouter.get('/reset-password', (req, res) => {
  res.render('reset-password', { token: typeof req.query.token === 'string' ? req.query.token : '', error: '' });
});

webRouter.post('/reset-password', async (req, res) => {
  try {
    const input = resetPasswordSchema.parse(req.body);
    await resetPassword(input.token, input.password);
    return res.redirect('/login?message=Password%20updated.%20Sign%20in%20with%20your%20new%20password.');
  } catch (err) {
    return res.status(formErrorStatus(err)).render('reset-password', {
      token: typeof req.body?.token === 'string' ? req.body.token : '', error: errorMessage(err),
    });
  }
});

webRouter.get('/account/security', requireWebAuth, (_req, res) => {
  res.render('account/security');
});

webRouter.post('/account/security/password', requireWebAuth, async (req, res) => {
  try {
    await changePassword(req.user!.userId, changePasswordSchema.parse(req.body));
  } catch (err) {
    return res.status(formErrorStatus(err)).render('account/security', { error: errorMessage(err) });
  }
  clearSessionCookie(res);
  res.redirect('/login?message=Password%20updated.%20Sign%20in%20with%20your%20new%20password.');
});

webRouter.get('/users', requireWebPermission('users.write'), async (req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, emailVerifiedAt: true, role: true, active: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
  res.render('users/list', { users, pendingUsers: users.filter(user => user.role === 'PENDING'), currentUserId: req.user!.userId, error: req.query.error });
});

webRouter.get('/activity', requireWebPermission('users.write'), async (_req, res) => {
  const events = await prisma.auditEvent.findMany({
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.render('audit/list', { events });
});

webRouter.post('/users/:id/approve', requireWebPermission('users.write'), async (req, res) => {
  try {
    const { role } = approveUserSchema.parse(req.body);
    await approveUser(req.params.id, role, req.user!.userId);
    res.redirect('/users');
  } catch (err) {
    res.redirect(`/users?error=${encodeURIComponent(errorMessage(err))}`);
  }
});

webRouter.post('/users/:id/role', requireWebPermission('users.write'), async (req, res) => {
  try {
    const { role } = changeUserRoleSchema.parse(req.body);
    await changeUserRole(req.params.id, role, req.user!.userId);
    res.redirect('/users');
  } catch (err) {
    res.redirect(`/users?error=${encodeURIComponent(errorMessage(err))}`);
  }
});

webRouter.post('/users/:id/access', requireWebPermission('users.write'), async (req, res) => {
  try {
    const { active } = setUserActiveSchema.parse(req.body);
    await setUserActive(req.params.id, active, req.user!.userId);
    res.redirect('/users');
  } catch (err) {
    res.redirect(`/users?error=${encodeURIComponent(errorMessage(err))}`);
  }
});

webRouter.get('/register', requireWebPermission('users.write'), (req, res) => {
  res.render('register', { error: req.query.error, registerDraft: { name: '', email: '', role: 'STAFF' }, registerFieldErrors: {} });
});

webRouter.post('/register', requireWebPermission('users.write'), async (req, res) => {
  try {
    const input = registerSchema.parse(req.body);
    await registerUser(input, req.user!.userId);
    res.redirect('/users');
  } catch (err) {
    res.status(formErrorStatus(err)).render('register', {
      error: errorMessage(err),
      registerDraft: textDraft(req.body, ['name', 'email', 'role']),
      registerFieldErrors: formFieldErrors(err, 'email', ['name', 'email', 'password', 'role']),
    });
  }
});

webRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.redirect('/login');
});

webRouter.get('/dashboard', requireWebAuth, async (req, res) => {
  const [user, customers, products, orders, invoices, purchaseOrders] = await Promise.all([
    getCurrentUser(req.user!.userId),
    listCustomers(),
    listProducts(),
    listOrders(),
    listInvoices(),
    listPurchaseOrders(),
  ]);
  const outstandingInvoiceCents = invoices.reduce(
    (sum, invoice) =>
      sum + invoice.totalCents - invoice.payments.reduce((paid, payment) => paid + payment.amountCents, 0),
    0,
  );
  const salesStages = {
    draft: orders.filter((order) => order.status === 'DRAFT').length,
    ready: orders.filter((order) => order.status === 'CONFIRMED' && !order.invoice).length,
    invoiced: orders.filter((order) => Boolean(order.invoice)).length,
    cancelled: orders.filter((order) => order.status === 'CANCELLED').length,
  };
  const lowStockProducts = products.filter((product) => {
    const inventory = product.inventoryItem;
    return product.reorderPoint > 0 && (inventory?.availableQty ?? 0) - (inventory?.reservedQty ?? 0) < product.reorderPoint;
  });
  res.render('dashboard', {
    user,
    asOf: new Date(),
    customerCount: customers.length,
    productCount: products.length,
    orderCount: orders.length,
    salesStages,
    pendingOrders: salesStages.draft + salesStages.ready,
    openPurchaseOrders: purchaseOrders.filter((order) => order.status === 'DRAFT' || order.status === 'ORDERED' || order.status === 'PARTIALLY_RECEIVED').length,
    outstandingInvoiceCents,
    paidRevenueCents: invoices
      .filter((invoice) => invoice.status === 'PAID')
      .reduce((sum, invoice) => sum + invoice.totalCents, 0),
    recentOrders: orders.slice(0, 6),
    recentPurchaseOrders: purchaseOrders.slice(0, 4),
    lowStockCount: lowStockProducts.length,
    lowStockProducts: lowStockProducts.slice(0, 5),
  });
});

webRouter.get('/analytics', requireWebAuth, async (req, res) => {
  res.render('analytics', { analytics: await getAnalytics(parseAnalyticsPeriod(req.query.days)) });
});

webRouter.get('/analytics/export.csv', requireWebAuth, async (req, res) => {
  const analytics = await getAnalytics(parseAnalyticsPeriod(req.query.days));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="erp-daily-analytics-${analytics.days}d.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(analyticsCsv(analytics));
});

webRouter.get('/customers', requireWebAuth, async (_req, res) => {
  res.render('customers/list', { customers: await listCustomers() });
});

webRouter.get('/customers/new', requireWebPermission('customers.write'), (req, res) => {
  res.render('customers/new', { error: req.query.error, draft: textDraft(undefined, ['name', 'email', 'phone']), fieldErrors: {} });
});

webRouter.post('/customers', requireWebPermission('customers.write'), async (req, res) => {
  try {
    const input = createCustomerSchema.parse(req.body);
    await createCustomer(input, req.user!.userId);
    res.redirect('/customers');
  } catch (err) {
    res.status(formErrorStatus(err)).render('customers/new', {
      error: errorMessage(err), draft: textDraft(req.body, ['name', 'email', 'phone']),
      fieldErrors: formFieldErrors(err, 'email', ['name', 'email', 'phone']),
    });
  }
});

webRouter.get('/customers/:id', requireWebAuth, async (req, res) => {
  res.render('customers/show', { customer: await getCustomer(req.params.id) });
});

webRouter.get('/products', requireWebAuth, async (_req, res) => {
  res.render('products/list', { products: await listProducts() });
});

webRouter.get('/orders', requireWebAuth, async (_req, res) => {
  res.render('orders/list', { orders: await listOrders() });
});

webRouter.get('/products/new', requireWebPermission('products.write'), (req, res) => {
  res.render('products/new', { error: req.query.error, draft: textDraft({ reorderPoint: 10 }, ['sku', 'name', 'description', 'priceDollars', 'reorderPoint']), fieldErrors: {} });
});

webRouter.post('/products', requireWebPermission('products.write'), async (req, res) => {
  try {
    const priceCents = req.body.priceDollars !== undefined
      ? parseMoneyDollarsToCents(req.body.priceDollars, 'sale price')
      : Number(req.body.priceCents);
    const input = createProductSchema.parse({ ...req.body, reorderPoint: req.body.reorderPoint === undefined ? undefined : Number(req.body.reorderPoint), priceCents });
    await createProduct(input, req.user!.userId);
    res.redirect('/products');
  } catch (err) {
    res.status(formErrorStatus(err)).render('products/new', {
      error: errorMessage(err), draft: textDraft(req.body, ['sku', 'name', 'description', 'priceDollars', 'reorderPoint']),
      fieldErrors: err instanceof AppError && err.statusCode === 400
        ? { priceDollars: err.message }
        : formFieldErrors(err, 'sku', ['sku', 'name', 'description', 'priceDollars', 'reorderPoint'], { priceCents: 'priceDollars' }),
    });
  }
});

webRouter.get('/products/:id', requireWebAuth, async (req, res) => {
  res.render('products/show', { product: await getProduct(req.params.id), error: req.query.error,
    stockDraft: textDraft(undefined, ['quantityDelta', 'reason']), stockFieldError: '', stockIdempotencyKey: randomUUID() });
});

webRouter.post('/products/:id/reorder-point', requireWebPermission('inventory.write'), async (req, res) => {
  try {
    const input = updateReorderPointSchema.parse({ reorderPoint: Number(req.body.reorderPoint) });
    await updateProductReorderPoint(req.params.id, input.reorderPoint, req.user!.userId);
    res.redirect(`/products/${req.params.id}`);
  } catch (err) {
    res.redirect(`/products/${req.params.id}?error=${encodeURIComponent(errorMessage(err))}`);
  }
});

webRouter.post('/products/:id/adjustments', requireWebPermission('inventory.write'), async (req, res) => {
  try {
    const key = stockIdempotencyKeySchema.parse(req.body.idempotencyKey);
    const input = adjustStockSchema.parse({ quantityDelta: Number(req.body.quantityDelta), reason: req.body.reason });
    await adjustStock(req.params.id, input.quantityDelta, input.reason, req.user!.userId, key);
    res.redirect(`/products/${req.params.id}`);
  } catch (err) {
    return res.status(formErrorStatus(err)).render('products/show', {
      product: await getProduct(req.params.id), error: errorMessage(err),
      stockDraft: textDraft(req.body, ['quantityDelta', 'reason']),
      stockIdempotencyKey: typeof req.body.idempotencyKey === 'string' && stockIdempotencyKeySchema.safeParse(req.body.idempotencyKey).success ? req.body.idempotencyKey : randomUUID(),
      stockFieldError: err instanceof AppError && (err.message.startsWith('Adjustment would leave') || err.message.startsWith('Stock adjustment')) ? err.message : '',
    });
  }
});

webRouter.get('/orders/new', requireWebPermission('orders.write'), async (req, res) => {
  const [customers, products] = await Promise.all([listCustomers(), listProducts()]);
  res.render('orders/new', { customers, products, selectedCustomerId: String(req.query.customerId || ''), draftItems: draftItems(null, 12), error: req.query.error });
});

webRouter.post('/orders', requireWebPermission('orders.write'), async (req, res) => {
  try {
    const input = createOrderSchema.parse({
      customerId: req.body.customerId,
      items: parseOrderItems(req.body.items),
    });
    const order = await createOrder(input, req.user!.userId);
    res.redirect(`/orders/${order.id}`);
  } catch (err) {
    const [customers, products] = await Promise.all([listCustomers(), listProducts()]);
    res.status(err instanceof AppError ? err.statusCode : err instanceof ZodError ? 400 : 500).render('orders/new', {
      customers, products, selectedCustomerId: String(req.body.customerId ?? ''),
      draftItems: draftItems(req.body.items, 12), error: errorMessage(err),
    });
  }
});

webRouter.get('/orders/:id', requireWebAuth, async (req, res) => {
  res.render('orders/show', {
    order: await getOrder(req.params.id), error: req.query.error,
    defaultInvoiceDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });
});

webRouter.post('/orders/:id/confirm', requireWebPermission('orders.write'), async (req, res) => {
  try {
    await confirmOrder(req.params.id, req.user!.userId);
  } catch (err) {
    return res.redirect(`/orders/${req.params.id}?error=${encodeURIComponent(errorMessage(err))}`);
  }
  res.redirect(`/orders/${req.params.id}`);
});

webRouter.post('/orders/:id/cancel', requireWebPermission('orders.write'), async (req, res) => {
  try {
    await cancelOrder(req.params.id, req.user!.userId);
  } catch (err) {
    return res.redirect(`/orders/${req.params.id}?error=${encodeURIComponent(errorMessage(err))}`);
  }
  res.redirect(`/orders/${req.params.id}`);
});

webRouter.post('/orders/:id/invoice', requireWebPermission('invoices.write'), async (req, res) => {
  try {
    const input = createInvoiceSchema.parse({ orderId: req.params.id, dueDate: req.body.dueDate || undefined });
    const invoice = await createInvoice(input, req.user!.userId);
    res.redirect(`/invoices/${invoice.id}`);
  } catch (err) {
    res.redirect(`/orders/${req.params.id}?error=${encodeURIComponent(errorMessage(err))}`);
  }
});

webRouter.get('/invoices', requireWebAuth, async (_req, res) => {
  res.render('invoices/list', { invoices: await listInvoices() });
});

webRouter.get('/invoices/:id', requireWebAuth, async (req, res) => {
  res.render('invoices/show', { invoice: await getInvoice(req.params.id), error: req.query.error,
      paymentDraft: null, paymentFieldError: '', paymentIdempotencyKey: randomUUID(), returnIdempotencyKey: randomUUID() });
});

webRouter.post('/invoices/:id/payments', requireWebPermission('payments.write'), async (req, res) => {
  try {
    const input = recordPaymentSchema.parse({
      amountCents: parseDollarsToCents(req.body.amountDollars),
      method: req.body.method || undefined,
        idempotencyKey: req.body.idempotencyKey,
    });
    await recordPayment(req.params.id, input, req.user!.userId);
  } catch (err) {
    const invoice = await getInvoice(req.params.id);
    const credited = invoice.creditNotes.reduce((sum, credit) => sum + credit.amountCents, 0);
    const outstanding = Math.max(0, invoice.totalCents - credited - invoice.payments.reduce((sum, payment) => sum + payment.amountCents, 0));
    const overpayment = err instanceof AppError && err.message.includes('would exceed invoice total');
    const message = overpayment
      ? `Amount exceeds the current outstanding balance ($${(outstanding / 100).toFixed(2)})`
      : errorMessage(err);
    return res.status(formErrorStatus(err)).render('invoices/show', {
      invoice, error: message, paymentDraft: textDraft(req.body, ['amountDollars', 'method']),
      paymentIdempotencyKey: req.body.idempotencyKey || randomUUID(),
      returnIdempotencyKey: randomUUID(),
      paymentFieldError: overpayment || err instanceof ZodError && err.issues.some((issue) => issue.path[0] === 'amountCents') || err instanceof AppError && err.message.startsWith('Enter a')
        ? message : '',
    });
  }
  res.redirect(`/invoices/${req.params.id}`);
});

webRouter.post('/invoices/:id/returns', requireWebPermission('returns.write'), async (req, res) => {
  try {
    const input = createReturnSchema.parse({
      reason: req.body.reason,
      items: parseReturnItems(req.body.items),
    });
    const idempotencyKey = returnIdempotencyKeySchema.parse(req.body.idempotencyKey);
    await createInvoiceReturn(req.params.id, idempotencyKey, input, req.user!.userId);
  } catch (err) {
    return res.redirect(`/invoices/${req.params.id}?error=${encodeURIComponent(errorMessage(err))}`);
  }
  res.redirect(`/invoices/${req.params.id}`);
});

webRouter.get('/suppliers', requireWebAuth, async (_req, res) => {
  res.render('suppliers/list', { suppliers: await listSuppliers() });
});

webRouter.get('/suppliers/new', requireWebPermission('suppliers.write'), (req, res) => {
  res.render('suppliers/new', { error: req.query.error, draft: textDraft(undefined, ['name', 'email', 'phone']), fieldErrors: {} });
});

webRouter.post('/suppliers', requireWebPermission('suppliers.write'), async (req, res) => {
  try {
    const input = createSupplierSchema.parse(req.body);
    await createSupplier(input, req.user!.userId);
    res.redirect('/suppliers');
  } catch (err) {
    res.status(formErrorStatus(err)).render('suppliers/new', {
      error: errorMessage(err), draft: textDraft(req.body, ['name', 'email', 'phone']),
      fieldErrors: formFieldErrors(err, 'email', ['name', 'email', 'phone']),
    });
  }
});

webRouter.get('/suppliers/:id', requireWebAuth, async (req, res) => {
  res.render('suppliers/show', { supplier: await getSupplier(req.params.id) });
});

webRouter.get('/purchase-orders', requireWebAuth, async (_req, res) => {
  res.render('purchase-orders/list', { purchaseOrders: await listPurchaseOrders() });
});

webRouter.get('/purchase-orders/new', requireWebPermission('purchases.write'), async (req, res) => {
  const [suppliers, products] = await Promise.all([listSuppliers(), listProducts()]);
  res.render('purchase-orders/new', { suppliers, products, selectedSupplierId: String(req.query.supplierId || ''), draftItems: draftItems(null, 3), error: req.query.error });
});

webRouter.post('/purchase-orders', requireWebPermission('purchases.write'), async (req, res) => {
  try {
    const input = createPurchaseOrderSchema.parse({
      supplierId: req.body.supplierId,
      items: parsePurchaseOrderItems(req.body.items),
    });
    const purchaseOrder = await createPurchaseOrder(input, req.user!.userId);
    res.redirect(`/purchase-orders/${purchaseOrder.id}`);
  } catch (err) {
    const [suppliers, products] = await Promise.all([listSuppliers(), listProducts()]);
    res.status(err instanceof AppError ? err.statusCode : err instanceof ZodError ? 400 : 500).render('purchase-orders/new', {
      suppliers, products, selectedSupplierId: String(req.body.supplierId ?? ''),
      draftItems: draftItems(req.body.items, 3), error: errorMessage(err),
    });
  }
});

webRouter.get('/purchase-orders/:id', requireWebAuth, async (req, res) => {
  res.render('purchase-orders/show', {
    purchaseOrder: await getPurchaseOrder(req.params.id),
    error: req.query.error,
    receiptIdempotencyKey: randomUUID(),
  });
});

webRouter.post('/purchase-orders/:id/submit', requireWebPermission('purchases.write'), async (req, res) => {
  try {
    await submitPurchaseOrder(req.params.id, req.user!.userId);
  } catch (err) {
    return res.redirect(`/purchase-orders/${req.params.id}?error=${encodeURIComponent(errorMessage(err))}`);
  }
  res.redirect(`/purchase-orders/${req.params.id}`);
});

webRouter.post('/purchase-orders/:id/receive', requireWebPermission('purchases.receive'), async (req, res) => {
  try {
    const key = idempotencyKeySchema.parse(req.body.receiptIdempotencyKey);
    const purchaseOrder = await getPurchaseOrder(req.params.id);
    const quantities = req.body.received ?? {};
    const input = receivePurchaseOrderSchema.parse({
      items: purchaseOrder.items.map((item) => ({ purchaseOrderItemId: item.id, quantity: Number(quantities[item.id]) }))
        .filter((item) => item.quantity > 0),
    });
    await receivePurchaseOrder(req.params.id, req.user!.userId, key, input);
  } catch (err) {
    return res.redirect(`/purchase-orders/${req.params.id}?error=${encodeURIComponent(errorMessage(err))}`);
  }
  res.redirect(`/purchase-orders/${req.params.id}`);
});

webRouter.post('/purchase-orders/:id/cancel', requireWebPermission('purchases.write'), async (req, res) => {
  try {
    await cancelPurchaseOrder(req.params.id, req.user!.userId);
  } catch (err) {
    return res.redirect(`/purchase-orders/${req.params.id}?error=${encodeURIComponent(errorMessage(err))}`);
  }
  res.redirect(`/purchase-orders/${req.params.id}`);
});
