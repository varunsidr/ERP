export type RuntimeEnvironment = Record<string, string | undefined>;
import { validateMailConfiguration } from '../lib/account-email';
import { validateTestSupportConfiguration } from '../lib/test-support';

const required = (environment: RuntimeEnvironment, key: string) => {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} must be set before the ERP server can start`);
  return value;
};

const parseAttemptLimit = (environment: RuntimeEnvironment, key: string, defaultValue: number) => {
  const value = environment[key]?.trim() || String(defaultValue);
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error(`${key} must be an integer between 1 and 1000`);
  }
  return limit;
};

const validatePostgresUrl = (value: string, key: string) => {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error(`${key} must be a valid PostgreSQL URL`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error(`${key} must be a PostgreSQL URL with a host and database name`);
  }
};

export const parseCorsOrigins = (value: string | undefined) =>
  (value ?? '').split(',').map(origin => origin.trim()).filter(Boolean).map((origin) => {
    let url: URL;
    try { url = new URL(origin); }
    catch { throw new Error(`CORS_ORIGINS contains an invalid origin: ${origin}`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error(`CORS_ORIGINS entries must be exact HTTP or HTTPS origins: ${origin}`);
    }
    return origin;
  });

export const parseRuntimeConfig = (environment: RuntimeEnvironment) => {
  const nodeEnvironment = environment.NODE_ENV ?? '';
  if (!['development', 'test', 'staging', 'production'].includes(nodeEnvironment)) {
    throw new Error('NODE_ENV must be explicitly set to development, test, staging, or production');
  }
  const deployed = ['staging', 'production'].includes(nodeEnvironment);
  const releaseSha = environment.APP_RELEASE_SHA?.trim() || (deployed ? required(environment, 'APP_RELEASE_SHA') : 'development');
  if (deployed && !/^[a-f0-9]{40}$/i.test(releaseSha)) {
    throw new Error('APP_RELEASE_SHA must be the full 40-character Git commit SHA in staging and production');
  }
  validateMailConfiguration(environment);
  validateTestSupportConfiguration(environment);
  const databaseUrl = required(environment, 'DATABASE_URL');
  const directUrl = required(environment, 'DATABASE_URL_UNPOOLED');
  const jwtSecret = required(environment, 'JWT_SECRET');
  validatePostgresUrl(databaseUrl, 'DATABASE_URL');
  validatePostgresUrl(directUrl, 'DATABASE_URL_UNPOOLED');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');

  const portValue = environment.PORT?.trim() || '4000';
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const trustProxyValue = environment.TRUST_PROXY_HOPS?.trim() || '0';
  const trustProxyHops = Number(trustProxyValue);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 5');
  }
  const authLoginAttemptLimit = parseAttemptLimit(environment, 'AUTH_LOGIN_ATTEMPT_LIMIT', 10);
  const authSignupAttemptLimit = parseAttemptLimit(environment, 'AUTH_SIGNUP_ATTEMPT_LIMIT', 5);

  return {
    port,
    trustProxyHops,
    authLoginAttemptLimit,
    authSignupAttemptLimit,
    production: nodeEnvironment === 'production',
    releaseSha,
    corsOrigins: new Set(parseCorsOrigins(environment.CORS_ORIGINS)),
  };
};
