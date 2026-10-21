import { createInvite, invitePeek, inviteRedeem, logout, otpStart, otpVerify, publicUser, requireInternal, requireSession, sendWhatsAppInvite } from './auth.js';
import { chatwootWebhook } from './chatwoot.js';
import { db, event, rateOk } from './db.js';
import { ENV } from './env.js';
import { gateway, uploadUrl } from './gateway.js';
import { HttpError, Router } from './http.js';
import { customerSend, listMessages, retryPending, waHistory } from './messages.js';
import { getQuote, listQuotes } from './quotes.js';
import { reconcileAsync } from './reconcile.js';
import { finishTurn, recoverStalledTurns } from './turns.js';

export const router = new Router();

router
  .on('GET', '/health', async () => ({ ok: true, t: new Date().toISOString() }))
  .on('GET', '/config', async () => ({
    supabase_url: ENV.SUPABASE_URL, supabase_key: ENV.SUPABASE_PUBLISHABLE_KEY,
    vapid_public_key: ENV.VAPID_PUBLIC_KEY || null, android_apk_url: ENV.ANDROID_APK_URL || null,
  }))

  // ---- auth
  .on('POST', '/auth/otp/start', otpStart)
  .on('POST', '/auth/otp/verify', otpVerify)
  .on('POST', '/auth/invite/peek', invitePeek)
  .on('POST', '/auth/invite/redeem', inviteRedeem)
  .on('POST', '/auth/logout', async ctx => logout(ctx, await requireSession(ctx)))

  // ---- me
  .on('GET', '/me', async ctx => {
    const s = await requireSession(ctx);
    return { user: publicUser(s.user), session_id: s.id };
  })
  .on('PATCH', '/me', async ctx => {
    const s = await requireSession(ctx);
    const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim().slice(0, 80) : '';
    if (!name) throw new HttpError(400, 'name_required');
    await db().from('app_users').update({ name }).eq('id', s.user.id);
    return { ok: true };
  })
  .on('GET', '/sessions', async ctx => {
    const s = await requireSession(ctx);
    const { data } = await db().from('app_sessions').select('id, platform, device_label, created_at, last_used_at')
      .eq('user_id', s.user.id).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('last_used_at', { ascending: false });
    return { sessions: (data || []).map(x => ({ ...x, current: x.id === s.id })) };
  })
  .on('DELETE', '/sessions/:id', async ctx => {
    const s = await requireSession(ctx);
    await db().from('app_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', ctx.params.id).eq('user_id', s.user.id);
    return { ok: true };
  })

  // ---- chat
  .on('GET', '/messages', async ctx => listMessages(ctx, await requireSession(ctx)))
  .on('POST', '/messages', async ctx => customerSend(ctx, await requireSession(ctx)))
  .on('POST', '/messages/retry', async ctx => retryPending(await requireSession(ctx)))
  .on('GET', '/history', async ctx => waHistory(ctx, await requireSession(ctx)))
  .on('POST', '/media/upload-url', async ctx => uploadUrl(ctx, (await requireSession(ctx)).user.phone))

  // ---- quotes
  .on('GET', '/quotes', async ctx => ({ quotes: await listQuotes((await requireSession(ctx)).user.phone) }))
  .on('GET', '/quotes/:ref', async ctx => {
    const q = await getQuote((await requireSession(ctx)).user.phone, ctx.params.ref);
    if (!q) throw new HttpError(404, 'not_found');
    return { quote: q };
  })
  .on('GET', '/branches', async ctx => {
    await requireSession(ctx);
    const { data } = await db().from('branches').select('trading_as, branch_address, branch_telephone, whatsapp, city, province, hours_mon_thu, hours_fri, hours_sat, hours_sun, latitude, longitude')
      .eq('is_active', true).order('trading_as');
    return { branches: data || [] };
  })

  // ---- push
  .on('POST', '/push/subscribe', async ctx => {
    const s = await requireSession(ctx);
    const kind = ctx.body.kind === 'expo' ? 'expo' : 'webpush';
    const endpoint = String(ctx.body.endpoint || ctx.body.token || '');
    if (!endpoint || endpoint.length > 1000) throw new HttpError(400, 'bad_subscription');
    if (!(await rateOk('push:' + s.user.id, 3600, 40))) throw new HttpError(429, 'rate_limited');
    if (kind === 'webpush') {
      let u: URL; try { u = new URL(endpoint); } catch { throw new HttpError(400, 'bad_subscription'); }
      const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
      if (u.protocol !== 'https:' || u.port || u.username || u.password || !(allowed.includes(u.hostname) || u.hostname.endsWith('.notify.windows.com'))) throw new HttpError(400, 'bad_subscription');
      if (!/^[\w-]{80,100}$/.test(String(ctx.body.keys?.p256dh || '')) || !/^[\w-]{20,30}$/.test(String(ctx.body.keys?.auth || ''))) throw new HttpError(400, 'bad_subscription');
    } else if (!/^(ExponentPushToken|ExpoPushToken)\[[\w-]+\]$/.test(endpoint)) throw new HttpError(400, 'bad_subscription');
    await db().from('app_push_subscriptions').upsert({ user_id: s.user.id, session_id: s.id, kind, endpoint, keys: kind === 'webpush' ? ctx.body.keys : null, fail_count: 0 }, { onConflict: 'endpoint' });
    await event(s.user.phone, 'push_enabled', { kind });
    return { ok: true };
  })
  .on('POST', '/push/unsubscribe', async ctx => {
    const s = await requireSession(ctx);
    await db().from('app_push_subscriptions').delete().eq('user_id', s.user.id).eq('endpoint', String(ctx.body.endpoint || ''));
    return { ok: true };
  })
  .on('POST', '/events', async ctx => {
    if (!(await rateOk('event:' + ctx.ip, 60, 20))) throw new HttpError(429, 'rate_limited');
    const s = await requireSession(ctx).catch(() => null);
    const name = String(ctx.body.event || '');
    if (!/^(installed|install_prompt_shown|install_accepted|push_denied|apk_download|opened)$/.test(name)) throw new HttpError(400, 'bad_event');
    await event(s?.user.phone || null, name, { platform: String(ctx.body.platform || '').slice(0, 20) });
    return { ok: true };
  })

  // ---- internal (n8n / ops)
  .on('POST', '/internal/invite', async ctx => { requireInternal(ctx); return createInvite(ctx.body.phone, { channel: ctx.body.channel || 'internal' }); })
  .on('POST', '/internal/invite/send', async ctx => { requireInternal(ctx); return sendWhatsAppInvite(ctx); })

  .on('POST', '/internal/turn/claim', async ctx => {
    requireInternal(ctx);
    const { data, error } = await db().rpc('app_claim_turn', { p_wa_id: String(ctx.body.wa_id || ''), p_phone: String(ctx.body.phone || ''), p_execution: String(ctx.body.execution || '') });
    if (error) throw new HttpError(503, 'claim_failed');
    return { claimed: data === true };
  })

  .on('POST', '/internal/reconcile', async ctx => { requireInternal(ctx); return reconcileAsync(); })
  .on('POST', '/internal/turn/finish', async ctx => {
    requireInternal(ctx);
    return finishTurn(ctx.body.execution, ctx.body.outcome);
  })
  .on('POST', '/internal/turn/recover', async ctx => { requireInternal(ctx); return recoverStalledTurns(); })

  // ---- integrations
  .on('*', '/wa/:secret/:rest*', gateway)
  .on('POST', '/chatwoot/:secret', chatwootWebhook);
