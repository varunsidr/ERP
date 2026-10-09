export type OutboxEmail = { to: string; purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'; url: string; createdAt: string };

const maxMessages = 200;
let messages: OutboxEmail[] = [];

export const pushOutboxEmail = (message: Omit<OutboxEmail, 'createdAt'>) => {
  messages.push({ ...message, createdAt: new Date().toISOString() });
  if (messages.length > maxMessages) messages = messages.slice(-maxMessages);
};

export const listOutboxEmails = (to?: string) =>
  to ? messages.filter(message => message.to.toLowerCase() === to.toLowerCase()) : [...messages];

export const clearOutboxEmails = () => { messages = []; };
