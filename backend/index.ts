import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { router, json, error, secrets, ai, db } from '@appdeploy/sdk';

const ADMIN_EMAIL = 'khushihomes3@gmail.com';

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString('hex');
}
function newToken() {
  return randomBytes(32).toString('hex');
}
async function findUser(email: string) {
  const { items } = await db.list<Record<string, unknown>>('users', { limit: 500 });
  return items.find(x => String(x.email || '').toLowerCase() === email.toLowerCase()) || null;
}
async function currentUser(event: any) {
  const header = String(event?.headers?.authorization || event?.headers?.Authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const { items } = await db.list<Record<string, unknown>>('sessions', { limit: 500 });
  const session = items.find(x => x.token === token);
  if (!session) return null;
  const [user] = await db.get<Record<string, unknown>>('users', [String(session.userId || '')]);
  if (!user) return null;
  const email = String(user.email || '');
  return { id: String(session.userId), email, name: String(user.name || ''), phone: String(user.phone || ''), admin: email.toLowerCase() === ADMIN_EMAIL };
}
async function requireUser(event: any) {
  const user = await currentUser(event);
  if (!user) throw new Error('Please sign in first.');
  return user;
}
async function appAction(event: any, body: any) {
  const user = await requireUser(event);
  const action = String(body?.action || '');
  if (action === 'get_profile') {
    const { items: profiles } = await db.list<Record<string, unknown>>('profiles', { limit: 500 });
    const profile = profiles.find(x => String(x.userId || '') === user.id) || null;
    const { items: subs } = await db.list<Record<string, unknown>>('subscriptions', { limit: 500 });
    const subscription = subs.find(x => String(x.userId || '') === user.id) || null;
    const { items: settings } = await db.list<Record<string, unknown>>('settings', { limit: 50 });
    const whatsapp = settings.find(x => x.key === 'whatsapp')?.value;
    return { profile, subscription, whatsapp, admin: user.admin };
  }
  if (action === 'get_plans') {
    const { items } = await db.list<Record<string, unknown>>('plans', { limit: 50 });
    return { plans: items };
  }
  if (action === 'save_subscription') {
    const plan = body?.plan || {};
    const { items } = await db.list<Record<string, unknown>>('subscriptions', { limit: 500 });
    const existing = items.find(x => String(x.userId || '') === user.id);
    const record = { userId: user.id, ...plan };
    if (existing) {
      const [ok] = await db.update('subscriptions', [{ id: existing.id, record }]);
      if (!ok) throw new Error('Could not save subscription.');
    } else {
      const [id] = await db.add('subscriptions', [record]);
      if (!id) throw new Error('Could not save subscription.');
    }
    return { saved: true };
  }
  if (action === 'save_plan') {
    if (!user.admin) throw new Error('Admin access required.');
    const plan = body?.plan || {};
    const { items } = await db.list<Record<string, unknown>>('plans', { limit: 50 });
    const existing = items.find(x => String(x.code || '') === String(plan.code || ''));
    if (existing) {
      const [ok] = await db.update('plans', [{ id: existing.id, record: { ...plan } }]);
      if (!ok) throw new Error('Could not save plan.');
    } else {
      const [id] = await db.add('plans', [{ ...plan }]);
      if (!id) throw new Error('Could not save plan.');
    }
    return { saved: true };
  }
  if (action === 'save_whatsapp') {
    if (!user.admin) throw new Error('Admin access required.');
    const { items } = await db.list<Record<string, unknown>>('settings', { limit: 50 });
    const existing = items.find(x => x.key === 'whatsapp');
    const record = { key: 'whatsapp', value: String(body?.whatsapp || '') };
    if (existing) await db.update('settings', [{ id: existing.id, record }]);
    else await db.add('settings', [record]);
    return { saved: true };
  }
  if (action === 'get_announcement') {
    const { items } = await db.list<Record<string, unknown>>('settings', { limit: 50 });
    const existing = items.find(x => x.key === 'announcement');
    const value = existing?.value;
    if (value && typeof value === 'object') return { announcement: value };
    return { announcement: { message: '', enabled: false } };
  }

  if (action === 'save_announcement') {
    if (!user.admin) throw new Error('Admin access required.');
    const announcement = body?.announcement || {};
    const record = {
      key: 'announcement',
      value: {
        message: String(announcement.message || ''),
        enabled: Boolean(announcement.enabled)
      }
    };
    const { items } = await db.list<Record<string, unknown>>('settings', { limit: 50 });
    const existing = items.find(x => x.key === 'announcement');
    if (existing) await db.update('settings', [{ id: existing.id, record }]);
    else await db.add('settings', [record]);
    return { saved: true };
  }

  if (action === 'save_enquiry') {
    const form = body?.form || {};
    const [id] = await db.add('enquiries', [{ ...form, userId: user.id, status: 'New', created_at: new Date().toISOString() }]);
    if (!id) throw new Error('Could not save enquiry.');
    return { saved: true };
  }
  if (action === 'get_enquiries') {
    if (!user.admin) throw new Error('Admin access required.');
    const { items } = await db.list<Record<string, unknown>>('enquiries', { limit: 100 });
    return { enquiries: items };
  }
  if (action === 'update_enquiry') {
    if (!user.admin) throw new Error('Admin access required.');
    const { items } = await db.list<Record<string, unknown>>('enquiries', { limit: 100 });
    const existing = items.find(x => x.id === String(body?.id || ''));
    if (!existing) throw new Error('Enquiry not found.');
    const [ok] = await db.update('enquiries', [{ id: existing.id, record: { ...existing, status: String(body?.status || 'New') } }]);
    if (!ok) throw new Error('Could not update enquiry.');
    return { saved: true };
  }
  if (action === 'delete_account') {
    const password = String(body?.password || '');
    const [record] = await db.get<Record<string, unknown>>('users', [user.id]);
    if (!record) throw new Error('Account not found.');
    const candidate = Buffer.from(hashPassword(password, String(record.salt || '')), 'hex');
    const expected = Buffer.from(String(record.passwordHash || ''), 'hex');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) throw new Error('Password is incorrect.');
    const { items: sessions } = await db.list<Record<string, unknown>>('sessions', { limit: 500 });
    const ids = sessions.filter(x => String(x.userId || '') === user.id).map(x => x.id);
    if (ids.length) await db.delete('sessions', ids);
    await db.delete('users', [user.id]);
    return { deleted: true };
  }
  throw new Error('Unknown account action.');
}

async function razorpayCredentials() {
  return { keyId: await secrets.readSecret('RAZORPAY_KEY_ID'), keySecret: await secrets.readSecret('RAZORPAY_KEY_SECRET') };
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
  'POST /api/auth/signup': [async ({ body }) => {
    const input = body as { email?: string; password?: string };
    const email = String(input?.email || '').trim().toLowerCase();
    const password = String(input?.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email)) return error('Enter a valid email address.', 400);
    if (password.length < 6) return error('Password must be at least 6 characters.', 400);
    if (await findUser(email)) return error('This email already has an account. Use Login.', 409);
    const salt = randomBytes(16).toString('hex');
    const [id] = await db.add('users', [{ email, passwordHash: hashPassword(password, salt), salt, name: '', phone: '' }]);
    if (!id) return error('Could not create account.', 500);
    const token = newToken();
    const [sid] = await db.add('sessions', [{ token, userId: id, created_at: new Date().toISOString() }]);
    if (!sid) return error('Could not start account session.', 500);
    return json({ token, user: { id, email, name: '', phone: '', admin: email === ADMIN_EMAIL } });
  }],
  'POST /api/auth/login': [async ({ body }) => {
    const input = body as { email?: string; password?: string };
    const email = String(input?.email || '').trim().toLowerCase();
    const password = String(input?.password || '');
    const user = await findUser(email);
    if (!user) return error('Email or password is incorrect.', 401);
    const candidate = Buffer.from(hashPassword(password, String(user.salt || '')), 'hex');
    const expected = Buffer.from(String(user.passwordHash || ''), 'hex');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return error('Email or password is incorrect.', 401);
    const token = newToken();
    const [sid] = await db.add('sessions', [{ token, userId: user.id, created_at: new Date().toISOString() }]);
    if (!sid) return error('Could not start account session.', 500);
    return json({ token, user: { id: user.id, email, name: String(user.name || ''), phone: String(user.phone || ''), admin: email === ADMIN_EMAIL } });
  }],
  'GET /api/auth/me': [async ({ event }) => {
    const user = await currentUser(event);
    if (!user) return error('Not signed in.', 401);
    return json({ user });
  }],
  'POST /api/auth/logout': [async ({ event }) => {
    const header = String(event?.headers?.authorization || event?.headers?.Authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token) {
      const { items } = await db.list<Record<string, unknown>>('sessions', { limit: 500 });
      const session = items.find(x => x.token === token);
      if (session) await db.delete('sessions', [session.id]);
    }
    return json({ signedOut: true });
  }],
  'POST /api/app/action': [async ({ event, body }) => {
    try { return json(await appAction(event, body)); } catch (e) { return error(e instanceof Error ? e.message : 'Request failed.', 401); }
  }],
  'POST /api/ai/help': [async ({ body }) => {
    const payload = body as { message?: string; history?: Array<{ role?: string; text?: string }> };
    const message = String(payload?.message || '').trim();
    if (!message) return error('Message is required.', 400);
    const history = Array.isArray(payload.history) ? payload.history.slice(-8).map(item => ({ role: item.role === 'assistant' ? 'assistant' as const : 'user' as const, content: String(item.text || '') })) : [];
    try {
      const result = await ai.generate({ system: 'You are Khushi AI for KHUSHI HOMES Smart Home. Help customers with Smart Home features, device demo requests, quotations and subscriptions. Never request passwords, OTPs, UPI PINs or card details.', messages: [...history, { role: 'user', content: message }], maxTokens: 350, thinkingMode: 'FAST' });
      return json({ text: result.text });
    } catch { return error('Khushi AI is temporarily unavailable.', 500); }
  }],
  'POST /api/payments/create-order': [async ({ body }) => {
    const input = body as { planCode?: string; amount?: number };
    if (!input.planCode || !Number.isInteger(input.amount) || Number(input.amount) <= 0) return error('Invalid plan payment.', 400);
    try {
      const { keyId, keySecret } = await razorpayCredentials();
      const response = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64'), 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: input.amount, currency: 'INR', receipt: 'khushi_smart_home_' + input.planCode + '_' + Date.now(), notes: { product: 'KHUSHI HOMES Smart Home', planCode: input.planCode } }) });
      const data = await response.json();
      if (!response.ok) return error(data?.error?.description || 'Razorpay order creation failed.', 502);
      return json({ orderId: data.id, keyId, amount: data.amount, currency: data.currency });
    } catch (err) { return error(err instanceof Error ? err.message : 'Could not create payment order.', 502); }
  }],
  'POST /api/payments/verify': [async ({ body }) => {
    const input = body as { razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string };
    if (!input.razorpay_order_id || !input.razorpay_payment_id || !input.razorpay_signature) return error('Missing payment verification fields.', 400);
    try {
      const { keySecret } = await razorpayCredentials();
      const expected = createHmac('sha256', keySecret).update(input.razorpay_order_id + '|' + input.razorpay_payment_id).digest('hex');
      if (expected !== input.razorpay_signature) return error('Payment signature verification failed.', 400);
      return json({ verified: true });
    } catch { return error('Could not verify payment.', 502); }
  }]
});
