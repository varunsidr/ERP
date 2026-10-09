import { appendFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { AppError } from './errors';
import { pushOutboxEmail } from './email-outbox';

export const accountEmailDisabled = (environment = process.env) => environment.MAIL_MODE?.trim() === 'disabled';

export const requireAccountEmail = () => {
  if (accountEmailDisabled()) throw new AppError(503,
    'New accounts and email recovery are unavailable in this demo. Contact the administrator.');
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

export const validateMailConfiguration = (environment: Record<string, string | undefined>) => {
  const mailMode = environment.MAIL_MODE?.trim();
  if (mailMode && !['smtp', 'disabled', 'outbox'].includes(mailMode)) throw new Error('MAIL_MODE must be smtp, disabled, or outbox');
  if (mailMode === 'outbox') {
    if (environment.NODE_ENV === 'production' || environment.ERP_TEST_SUPPORT?.trim() !== 'enabled') {
      throw new Error('MAIL_MODE=outbox requires ERP_TEST_SUPPORT=enabled and is not allowed in production');
    }
    return { mode: 'outbox' as const };
  }
  if (mailMode === 'disabled') {
    if (environment.NODE_ENV !== 'staging') throw new Error('Disabled email is supported only for the staging demo');
    return { mode: 'disabled' as const };
  }
  const keys = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASSWORD', 'MAIL_FROM'];
  const present = keys.filter(key => Boolean(environment[key]?.trim()));
  const localMode = ['development', 'test'].includes(environment.NODE_ENV ?? '');
  if (!present.length && localMode && !mailMode) return { mode: 'console' as const };
  if (present.length !== keys.length) throw new Error(`Set all mail settings together: ${keys.join(', ')}`);

  const port = Number(environment.MAIL_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MAIL_PORT must be an integer between 1 and 65535');
  const host = environment.MAIL_HOST!.trim();
  if (/\s|\/|@/.test(host)) throw new Error('MAIL_HOST must be a hostname');
  const from = environment.MAIL_FROM!.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) throw new Error('MAIL_FROM must be a valid email address');

  let appUrl: URL;
  try { appUrl = new URL(environment.PUBLIC_APP_URL ?? ''); }
  catch { throw new Error('PUBLIC_APP_URL must be an absolute HTTPS URL'); }
  if (appUrl.protocol !== 'https:' && !(localMode && appUrl.hostname === 'localhost')) {
    throw new Error('PUBLIC_APP_URL must use HTTPS');
  }
  if (appUrl.username || appUrl.password || appUrl.search || appUrl.hash) throw new Error('PUBLIC_APP_URL must be an origin or base path only');
  return {
    mode: 'smtp' as const, host, port, user: environment.MAIL_USER!.trim(), password: environment.MAIL_PASSWORD!, from,
    secure: port === 465, appUrl: appUrl.toString().replace(/\/$/, ''),
  };
};

export const sendAccountActionEmail = async (
  input: { to: string; name: string; purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'; rawToken: string },
) => {
  const config = validateMailConfiguration(process.env);
  if (config.mode === 'disabled') {
    requireAccountEmail();
    throw new Error('Email delivery is disabled');
  }
  const link = new URL(input.purpose === 'EMAIL_VERIFICATION' ? '/verify-email' : '/reset-password',
    config.mode === 'smtp' ? config.appUrl : (process.env.PUBLIC_APP_URL || `http://localhost:${process.env.PORT || '4000'}`));
  link.searchParams.set('token', input.rawToken);
  if (config.mode === 'outbox') {
    pushOutboxEmail({ to: input.to, purpose: input.purpose, url: link.toString() });
    return;
  }
  if (process.env.NODE_ENV === 'test') {
    const outbox = process.env.ERP_TEST_EMAIL_OUTBOX;
    if (outbox) appendFileSync(outbox, `${JSON.stringify({ to: input.to, purpose: input.purpose, url: link.toString() })}\n`, { encoding: 'utf8', mode: 0o600 });
    return;
  }
  const action = input.purpose === 'EMAIL_VERIFICATION' ? 'Verify your email address' : 'Reset your password';
  const greeting = escapeHtml(input.name);
  const href = escapeHtml(link.toString());
  const transport = config.mode === 'smtp'
    ? nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, requireTLS: !config.secure,
      auth: { user: config.user, pass: config.password }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 })
    : null;
  if (transport) {
    try {
      await transport.sendMail({ from: config.from, to: input.to, subject: action,
        text: `${action}\n\nHello ${input.name},\n\nContinue securely: ${link.toString()}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this email.`,
        html: `<p>Hello ${greeting},</p><p><a href="${href}">${action}</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>` });
    } finally { transport.close(); }
  } else {
    // Local-only development delivery. Deployed environments reject this mode at startup.
    process.stdout.write(`[development email] ${action}: ${link.toString()}\n`);
  }
};
