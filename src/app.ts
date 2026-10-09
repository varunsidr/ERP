import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { customersRouter } from './modules/customers/customers.routes';
import { productsRouter } from './modules/products/products.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { ordersRouter } from './modules/orders/orders.routes';
import { invoicesRouter } from './modules/invoices/invoices.routes';
import { suppliersRouter } from './modules/suppliers/suppliers.routes';
import { purchasingRouter } from './modules/purchasing/purchasing.routes';
import { errorMiddleware } from './middleware/error.middleware';
import { webRouter, webViewsPath } from './web/web.routes';
import { attachOptionalUser } from './web/web.middleware';
import { csrfProtection } from './web/csrf.middleware';
import { prisma } from './lib/prisma';
import { parseCorsOrigins } from './config/runtime-config';
import { requestLoggingMiddleware } from './middleware/request-logging.middleware';
import { secureCookiesAndTransport } from './config/environment';
import { testSupportEnabled } from './lib/test-support';
import { testSupportRouter } from './test-support/test-support.routes';

export const createApp = (trustProxyHops = 0, releaseSha = process.env.APP_RELEASE_SHA || 'development') => {
  const app = express();
  app.set('trust proxy', trustProxyHops);
  app.disable('x-powered-by');
  app.use(requestLoggingMiddleware);
  app.use((_req, res, next) => {
    res.setHeader('X-ERP-Release', releaseSha);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'");
    if (secureCookiesAndTransport()) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const allowedOrigins = new Set(parseCorsOrigins(process.env.CORS_ORIGINS));
  // Browser clients are same-origin by default; explicitly allow trusted external API frontends.
  app.use('/api', cors({ origin: (origin, callback) => callback(null, Boolean(origin && allowedOrigins.has(origin))) }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.set('view engine', 'ejs');
  app.set('views', webViewsPath);

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  // Keep process liveness separate from database readiness for deployment health checks.
  app.get('/ready', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  if (testSupportEnabled()) app.use('/__test', testSupportRouter);

  app.use('/api/auth', authRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/purchase-orders', purchasingRouter);

  // Server-rendered web UI (Playwright's target): cookie-session auth, not the JWT
  // bearer-header auth the /api/* routes above use.
  app.use(attachOptionalUser, csrfProtection, webRouter);

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route not found' });
    return res.status(404).render('system-error', {
      pageTitle: 'Page not found', errorCode: '404', errorTitle: 'Page not found',
      errorDescription: 'This page may have moved, or the address may be incorrect.',
    });
  });

  // Must be registered last: catches errors thrown/forwarded by every router above.
  app.use(errorMiddleware);

  return app;
};
