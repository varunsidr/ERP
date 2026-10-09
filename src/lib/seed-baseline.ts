import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

export const roleUserEmails = {
  SALES: 'sales@mini-erp.test',
  PURCHASING: 'purchasing@mini-erp.test',
  INVENTORY: 'inventory@mini-erp.test',
  STAFF: 'staff@mini-erp.test',
} as const;

export const resolveSeedPassword = (databaseUrl = process.env.DATABASE_URL || '') => {
  const databaseHost = new URL(databaseUrl).hostname;
  const localDatabase = ['localhost', '127.0.0.1', '::1'].includes(databaseHost);
  const seedPassword = process.env.ERP_SEED_ADMIN_PASSWORD || (localDatabase ? 'Password123!' : '');
  if (!seedPassword || seedPassword.length < 12) {
    throw new Error('Set ERP_SEED_ADMIN_PASSWORD (at least 12 characters) before seeding a hosted database');
  }
  return seedPassword;
};

export const seedBaseline = async (prisma: PrismaClient, seedPassword: string, options: { roleUsers?: boolean } = {}) => {
  const passwordHash = await bcrypt.hash(seedPassword, 10);
  await prisma.user.upsert({
    where: { email: 'admin@mini-erp.test' },
    update: {},
    create: { email: 'admin@mini-erp.test', name: 'Admin', passwordHash, role: 'ADMIN', emailVerifiedAt: new Date() },
  });
  if (options.roleUsers) {
    for (const [role, email] of Object.entries(roleUserEmails)) {
      await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, name: `${role[0]}${role.slice(1).toLowerCase()} User`, passwordHash, role, emailVerifiedAt: new Date() },
      });
    }
  }

  const customer = await prisma.customer.upsert({
    where: { email: 'jane.doe@example.com' },
    update: {},
    create: { name: 'Jane Doe', email: 'jane.doe@example.com', phone: '555-0100' },
  });

  const product = await prisma.product.upsert({
    where: { sku: 'WIDGET-001' },
    update: {},
    create: {
      sku: 'WIDGET-001',
      name: 'Widget',
      description: 'A basic seeded widget',
      priceCents: 1999,
      inventoryItem: { create: { availableQty: 50, reservedQty: 0 } },
    },
  });

  const supplier = await prisma.supplier.upsert({
    where: { email: 'supply@example.com' },
    update: {},
    create: { name: 'Northwind Supply Co.', email: 'supply@example.com', phone: '555-0142' },
  });

  return { customer: customer.email, product: product.sku, supplier: supplier.email };
};
