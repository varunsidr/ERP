// Seeds a minimal, deterministic data set for local development and Playwright tests.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { resolveSeedPassword, seedBaseline } from '../src/lib/seed-baseline';

const prisma = new PrismaClient();

async function main() {
  const seeded = await seedBaseline(prisma, resolveSeedPassword(), {
    roleUsers: process.env.ERP_SEED_ROLE_USERS === 'true',
  });
  console.log('Seeded:', seeded);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
