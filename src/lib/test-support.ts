import { timingSafeEqual } from 'node:crypto';

type Environment = Record<string, string | undefined>;

export const testSupportEnabled = (environment: Environment = process.env) =>
  environment.ERP_TEST_SUPPORT?.trim() === 'enabled';

// Test support can wipe data, so it is never allowed in production and always needs a shared secret.
export const validateTestSupportConfiguration = (environment: Environment) => {
  const value = environment.ERP_TEST_SUPPORT?.trim();
  if (value && value !== 'enabled') throw new Error('ERP_TEST_SUPPORT must be enabled when set');
  if (!testSupportEnabled(environment)) return;
  if (environment.NODE_ENV === 'production') throw new Error('ERP_TEST_SUPPORT is not allowed in production');
  if ((environment.ERP_TEST_SUPPORT_TOKEN?.trim().length ?? 0) < 24) {
    throw new Error('ERP_TEST_SUPPORT_TOKEN must contain at least 24 characters when ERP_TEST_SUPPORT is enabled');
  }
};

export const testSupportTokenMatches = (supplied: string | undefined, environment: Environment = process.env) => {
  const expected = environment.ERP_TEST_SUPPORT_TOKEN?.trim();
  if (!expected || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
