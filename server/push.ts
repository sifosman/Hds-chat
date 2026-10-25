import webpush from 'web-push';
import { db } from './db.js';
import { ENV } from './env.js';

let configured = false;
function cfg() {
  if (!configured && ENV.VAPID_PUBLIC_KEY && ENV.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(ENV.VAPID_SUBJECT, ENV.VAPID_PUBLIC_KEY, ENV.VAPID_PRIVATE_KEY);
    configured = true;
  }
  return configured;
}

export interface PushNote { title: string; body: string; url?: string; tag?: string }

export async function pushToUser(userId: string, note: PushNote) {
  // Web push is disabled: only native-app (expo) subscriptions are notified.
  const { data: subs } = await db().from('app_push_subscriptions').select('*,app_sessions!inner(revoked_at,expires_at)').eq('user_id', userId).eq('kind', 'expo')
    .is('app_sessions.revoked_at', null).gt('app_sessions.expires_at', new Date().toISOString()).limit(20).abortSignal(AbortSignal.timeout(4000));
  if (!subs?.length) return { sent: 0 };
  let sent = 0;
  const expo: any[] = [];
  await Promise.all(subs.map(async (s: any) => {
    if (s.kind === 'expo') { expo.push(s); return; }
    if (!cfg()) return;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(note), { TTL: 3600 * 24, urgency: 'high', timeout: 5000 });
      sent++;
      await db().from('app_push_subscriptions').update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq('id', s.id);
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await db().from('app_push_subscriptions').delete().eq('id', s.id);
      else await db().from('app_push_subscriptions').update({ fail_count: (s.fail_count || 0) + 1 }).eq('id', s.id);
    }
  }));
  if (expo.length) {
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(expo.map(s => ({ to: s.endpoint, title: note.title, body: note.body, data: { url: note.url || '/' }, sound: 'default', priority: 'high', channelId: 'messages' }))),
      });
      const j: any = await r.json().catch(() => ({}));
      (j.data || []).forEach((t: any, i: number) => {
        if (t.status === 'ok') sent++;
        else if (t.details?.error === 'DeviceNotRegistered') db().from('app_push_subscriptions').delete().eq('id', expo[i].id).then(() => {});
      });
    } catch { /* non-fatal */ }
  }
  return { sent };
}
