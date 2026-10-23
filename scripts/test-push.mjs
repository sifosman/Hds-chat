// Send a test web push to an app user's active subscriptions.
// Usage: node scripts/test-push.mjs <phone> ["message body"]
import { readFileSync } from 'node:fs';
import webpush from 'web-push';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => /^[A-Z_]+=/i.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));

const phone = process.argv[2];
const body = process.argv[3] || 'Test notification from HDS Chat — it works!';
if (!phone) { console.error('Usage: node scripts/test-push.mjs <phone> ["body"]'); process.exit(1); }

const db = (path) => fetch(env.SUPABASE_URL + '/rest/v1/' + path, {
  headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY },
}).then(r => r.json());

const users = await db(`app_users?select=id,phone&phone=eq.${encodeURIComponent(phone)}`);
if (!users.length) { console.error('No app_users row for', phone); process.exit(1); }

const now = new Date().toISOString();
const subs = await db(
  `app_push_subscriptions?select=*,app_sessions!inner(revoked_at,expires_at)` +
  `&user_id=eq.${users[0].id}&app_sessions.revoked_at=is.null&app_sessions.expires_at=gt.${now}`);
if (!subs.length) { console.error('No active push subscriptions for', phone); process.exit(1); }

webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
const note = JSON.stringify({ title: 'William — HDS', body, url: '/', tag: 'chat-test' });
const expoSubs = subs.filter(s => s.kind === 'expo');
if (expoSubs.length) {
  const r = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(expoSubs.map(s => ({ to: s.endpoint, title: 'William — HDS', body, data: { url: '/' }, sound: 'default', priority: 'high', channelId: 'messages' }))),
  });
  const j = await r.json().catch(() => ({}));
  (j.data || []).forEach((t, i) => console.log(t.status === 'ok' ? 'SENT to' : 'FAILED', expoSubs[i].endpoint.slice(0, 45), t.status === 'ok' ? '' : JSON.stringify(t.details || t)));
}
for (const s of subs) {
  if (s.kind !== 'webpush') continue;
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, note, { TTL: 3600, urgency: 'high', timeout: 5000 });
    console.log('SENT to', s.endpoint.slice(0, 60));
  } catch (e) {
    console.log('FAILED', e.statusCode, e.body || e.message);
  }
}
