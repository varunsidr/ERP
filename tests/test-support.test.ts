import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app';
import { parseRuntimeConfig } from '../src/config/runtime-config';
import { sendAccountActionEmail, validateMailConfiguration } from '../src/lib/account-email';
import { clearOutboxEmails, listOutboxEmails } from '../src/lib/email-outbox';

const token = 'test-support-token-0123456789abcdef';
const base = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost:5432/erp',
  DATABASE_URL_UNPOOLED: 'postgresql://u:p@localhost:5432/erp', JWT_SECRET: 'x'.repeat(48) };

const withEnvironment = (t: { after: (callback: () => void) => void }, values: Record<string, string | undefined>) => {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
};

test('test support needs a strong token and is rejected in production', () => {
  assert.doesNotThrow(() => parseRuntimeConfig({ ...base, ERP_TEST_SUPPORT: 'enabled', ERP_TEST_SUPPORT_TOKEN: token }));
  assert.throws(() => parseRuntimeConfig({ ...base, ERP_TEST_SUPPORT: 'enabled' }), /ERP_TEST_SUPPORT_TOKEN/);
  assert.throws(() => parseRuntimeConfig({ ...base, ERP_TEST_SUPPORT: 'yes' }), /must be enabled/);
  assert.throws(() => parseRuntimeConfig({ ...base, NODE_ENV: 'production', APP_RELEASE_SHA: 'a'.repeat(40),
    MAIL_HOST: 'smtp.example.test', MAIL_PORT: '587', MAIL_USER: 'u', MAIL_PASSWORD: 'p', MAIL_FROM: 'a@example.test',
    PUBLIC_APP_URL: 'https://erp.example.test', ERP_TEST_SUPPORT: 'enabled', ERP_TEST_SUPPORT_TOKEN: token }), /not allowed in production/);
});

test('outbox mail mode is limited to non-production test support', () => {
  assert.deepEqual(validateMailConfiguration({ NODE_ENV: 'staging', MAIL_MODE: 'outbox', ERP_TEST_SUPPORT: 'enabled' }), { mode: 'outbox' });
  assert.throws(() => validateMailConfiguration({ NODE_ENV: 'staging', MAIL_MODE: 'outbox' }), /requires ERP_TEST_SUPPORT/);
  assert.throws(() => validateMailConfiguration({ NODE_ENV: 'production', MAIL_MODE: 'outbox', ERP_TEST_SUPPORT: 'enabled' }), /not allowed in production/);
});

test('outbox mode stores account links instead of sending them', async (t) => {
  withEnvironment(t, { NODE_ENV: 'development', MAIL_MODE: 'outbox', ERP_TEST_SUPPORT: 'enabled', PUBLIC_APP_URL: 'http://localhost:4000' });
  clearOutboxEmails();
  await sendAccountActionEmail({ to: 'New.User@example.test', name: 'New', purpose: 'EMAIL_VERIFICATION', rawToken: 'abc' });
  const [message] = listOutboxEmails('new.user@example.test');
  assert.equal(message.purpose, 'EMAIL_VERIFICATION');
  assert.equal(message.url, 'http://localhost:4000/verify-email?token=abc');
  clearOutboxEmails();
});

test('test-support routes are absent unless enabled and always token protected', async (t) => {
  withEnvironment(t, { NODE_ENV: 'development', MAIL_MODE: 'outbox', JWT_SECRET: base.JWT_SECRET, ERP_TEST_SUPPORT: undefined, ERP_TEST_SUPPORT_TOKEN: undefined });
  const listen = async () => {
    const server = createApp().listen(0);
    t.after(() => { server.close(); });
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  };
  assert.equal((await fetch(`${await listen()}/__test/emails`, { headers: { 'x-erp-test-token': token } })).status, 404);

  withEnvironment(t, { ERP_TEST_SUPPORT: 'enabled', ERP_TEST_SUPPORT_TOKEN: token });
  const url = await listen();
  assert.equal((await fetch(`${url}/__test/emails`)).status, 404);
  assert.equal((await fetch(`${url}/__test/emails`, { headers: { 'x-erp-test-token': 'wrong-token-value-0123456789' } })).status, 404);
  assert.equal((await fetch(`${url}/__test/reset`, { method: 'POST' })).status, 404);
  const ok = await fetch(`${url}/__test/emails`, { headers: { 'x-erp-test-token': token } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { emails: [] });
});