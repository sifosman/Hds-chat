import { db, event, rateOk } from './db.js';
import { ENV, isTestPhone } from './env.js';
import { Ctx, HttpError } from './http.js';
import { deliverOtp, waSendImage, waSendText, waSendVideo, waWindowOpen } from './otp.js';
import { maskName, maskPhone, normalizePhone, randomCode, randomToken, safeEqual, sha256 } from './util.js';

export interface AppUser { id: string; phone: string; name: string | null; realtime_topic: string; status: string; created_at: string; wa_history_cutoff: string }
export interface Session { id: string; user: AppUser }

const OTP_TTL_MIN = 10;
const INVITE_TTL_H = 72;
const testAuthEnabled = () => process.env.TEST_AUTH_ENABLED === 'true' && /^\d{6}$/.test(ENV.TEST_OTP_CODE);
const validExpiry = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();

async function authRpc(name: string, args: Record<string, unknown>) {
  try {
    const { data, error } = await db().rpc(name, args);
    if (error || !data || typeof data !== 'object') throw new Error('unavailable');
    return data as Record<string, unknown>;
  } catch {
    // Neither database diagnostics nor request credentials belong in responses/logs.
    throw new HttpError(503, 'auth_unavailable', 'Sign-in is temporarily unavailable. Please try again.');
  }
}

async function displayName(phone: string): Promise<string | null> {
  const { data } = await db().from('customer_profiles').select('name, metadata').eq('phone_number', phone).maybeSingle();
  const real = (data?.metadata as any)?.real_name;
  const n = real || data?.name || null;
  return n && !/^\+?\d[\d\s]+$/.test(n) ? n : null;
}

export async function getOrCreateUser(phone: string, source: string): Promise<AppUser> {
  const { data: existing } = await db().from('app_users').select('*').eq('phone', phone).maybeSingle();
  if (existing) return existing as AppUser;
  const name = await displayName(phone);
  const { data, error } = await db().from('app_users').insert({ phone, name, source }).select('*').single();
  if (error) {
    // race: created concurrently
    const { data: again } = await db().from('app_users').select('*').eq('phone', phone).single();
    if (again) return again as AppUser;
    throw new HttpError(503, 'user_create_failed');
  }
  await event(phone, 'user_created', { source });
  return data as AppUser;
}

async function createSession(user: AppUser, ctx: Ctx, via: string) {
  if (user.status !== 'active') throw new HttpError(403, 'blocked');
  const token = randomToken(32);
  const platform = String(ctx.body.platform || 'web').slice(0, 20);
  const { data, error } = await db().from('app_sessions').insert({
    user_id: user.id, token_hash: sha256(token), platform,
    device_label: String(ctx.body.device || '').slice(0, 80) || null,
    user_agent: String(ctx.headers['user-agent'] || '').slice(0, 300),
  }).select('id').single();
  if (error || !data?.id) throw new HttpError(503, 'session_failed');
  await db().from('app_users').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id);
  await event(user.phone, 'signed_in', { via, platform });
  return { token, session_id: data.id, user: publicUser(user) };
}

export const publicUser = (u: AppUser) => ({ id: u.id, phone: u.phone, name: u.name, topic: u.realtime_topic });

export async function requireSession(ctx: Ctx): Promise<Session> {
  const h = String(ctx.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(401, 'unauthorized');
  const { data } = await db().from('app_sessions')
    .select('id, revoked_at, expires_at, last_used_at, app_users(*)')
    .eq('token_hash', sha256(token)).maybeSingle();
  if (!data || data.revoked_at || !validExpiry(data.expires_at)) throw new HttpError(401, 'unauthorized');
  const user = (data as any).app_users as AppUser;
  if (!user || user.status !== 'active') throw new HttpError(401, 'unauthorized');
  // sliding expiry, at most one write per 10 minutes
  if (Date.now() - new Date(data.last_used_at).getTime() > 600_000) {
    const now = new Date();
    await db().from('app_sessions').update({ last_used_at: now.toISOString(), expires_at: new Date(now.getTime() + 180 * 864e5).toISOString() }).eq('id', data.id);
    await db().from('app_users').update({ last_seen_at: now.toISOString() }).eq('id', user.id);
  }
  return { id: data.id, user };
}

// ---------------- OTP ----------------
export async function otpStart(ctx: Ctx) {
  const phone = normalizePhone(ctx.body.phone);
  if (!phone) throw new HttpError(400, 'invalid_phone', 'Please enter a valid cellphone number.');
  if (!(await rateOk('otp:ip:' + ctx.ip, 3600, 20))) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again later.');
  if (!(await rateOk('otp:phone:' + phone, 600, 3)) || !(await rateOk('otp:phoneday:' + phone, 86400, 10)))
    throw new HttpError(429, 'rate_limited', 'Too many codes requested. Please wait a few minutes.');

  const test = isTestPhone(phone);
  if (test && !testAuthEnabled()) throw new HttpError(400, 'invalid_phone');
  const code = test ? ENV.TEST_OTP_CODE : randomCode();
  let channel = 'test';
  if (!test) {
    const preferred = typeof ctx.body.channel === 'string' ? ctx.body.channel : undefined;
    const r = await deliverOtp(phone, code, preferred);
    if (r.ok === false) {
      await event(phone, 'otp_undeliverable', { reasons: r.reasons });
      throw new HttpError(422, 'no_channel', r.message);
    }
    channel = r.channel;
  }
  // Replace older codes in one transaction, serialized with verification for this phone.
  const issued = await authRpc('app_auth_issue_otp', {
    p_phone: phone, p_code_hash: sha256(phone + ':' + code), p_channel: channel,
  });
  if (issued.status !== 'issued') throw new HttpError(503, 'auth_unavailable');
  await event(phone, 'otp_sent', { channel });
  return { ok: true, phone, channel, expires_in: OTP_TTL_MIN * 60 };
}

export async function otpVerify(ctx: Ctx) {
  const phone = normalizePhone(ctx.body.phone);
  const code = ctx.body.code;
  if (!phone || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new HttpError(400, 'invalid_code', 'Enter the 6-digit code.');
  if (isTestPhone(phone) && !testAuthEnabled()) throw new HttpError(400, 'invalid_code');
  if (!(await rateOk('otpv:ip:' + ctx.ip, 3600, 40))) throw new HttpError(429, 'rate_limited');
  const result = await authRpc('app_auth_verify_otp', { p_phone: phone, p_code_hash: sha256(phone + ':' + code) });
  if (result.status === 'expired') throw new HttpError(400, 'expired', 'That code has expired. Request a new one.');
  if (result.status === 'too_many_attempts') throw new HttpError(400, 'too_many_attempts', 'Too many wrong codes. Request a new one.');
  if (result.status === 'wrong_code') throw new HttpError(400, 'wrong_code', 'That code is not correct.');
  if (result.status !== 'verified') throw new HttpError(503, 'auth_unavailable');
  const user = await getOrCreateUser(phone, 'otp');
  return createSession(user, ctx, 'otp');
}

// ---------------- Invite links ----------------
export async function createInvite(phoneIn: unknown, meta: Record<string, unknown> = {}) {
  const phone = normalizePhone(phoneIn);
  if (!phone) throw new HttpError(400, 'invalid_phone');
  const token = randomToken(32);
  const { error } = await db().from('app_auth_codes').insert({
    phone, purpose: 'invite', code_hash: sha256(token), channel: String(meta.channel || 'manual'), meta,
    expires_at: new Date(Date.now() + INVITE_TTL_H * 3600_000).toISOString(),
  });
  if (error) throw new HttpError(503, 'auth_unavailable');
  await event(phone, 'invite_created', { channel: meta.channel || 'manual' });
  return { url: `${ENV.PUBLIC_URL}/i/${token}`, expires_in_hours: INVITE_TTL_H };
}

async function findInvite(token: unknown) {
  if (typeof token !== 'string' || token.length < 30 || token.length > 100) throw new HttpError(400, 'invalid_link');
  const { data } = await db().from('app_auth_codes').select('*').eq('purpose', 'invite').eq('code_hash', sha256(token)).maybeSingle();
  if (!data) throw new HttpError(404, 'invalid_link', 'This link is not valid.');
  if (data.consumed_at) throw new HttpError(410, 'used', 'This link was already used.');
  if (!validExpiry(data.expires_at)) throw new HttpError(410, 'expired', 'This link has expired.');
  return data;
}

/** Read-only: does NOT consume (link scanners / previews hit GET pages). */
export async function invitePeek(ctx: Ctx) {
  if (!(await rateOk('inv:ip:' + ctx.ip, 3600, 60))) throw new HttpError(429, 'rate_limited');
  const inv = await findInvite(ctx.body.token);
  await event(inv.phone, 'invite_opened', {});
  return { ok: true, name: maskName(await displayName(inv.phone)), phone: maskPhone(inv.phone) };
}

export async function inviteRedeem(ctx: Ctx) {
  if (!(await rateOk('inv:ip:' + ctx.ip, 3600, 60))) throw new HttpError(429, 'rate_limited');
  const token = ctx.body.token;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(400, 'invalid_link');
  const inv = await authRpc('app_auth_redeem_invite', { p_code_hash: sha256(token) });
  if (inv.status === 'invalid_link') throw new HttpError(404, 'invalid_link');
  if (inv.status === 'used') throw new HttpError(410, 'used', 'This link was already used.');
  if (inv.status === 'expired') throw new HttpError(410, 'expired', 'This link has expired.');
  if (inv.status !== 'verified' || typeof inv.phone !== 'string') throw new HttpError(503, 'auth_unavailable');
  const user = await getOrCreateUser(inv.phone, 'invite:' + (inv.channel || 'manual'));
  return createSession(user, ctx, 'invite');
}

// Served from the stable project alias: the custom domain can still resolve to the old host.
const INVITE_CARD_URL = 'https://hds-chat.vercel.app/invite-card.jpg';
// Animated variant, kept for later — to use it, send INVITE_CLIP_URL via waSendVideo first.
const INVITE_CLIP_URL = 'https://hds-chat.vercel.app/invite-card.mp4';

const inviteText = (name: string | null, url: string) =>
  `Hi${name ? ' ' + name : ''}! The new HDS app is here — quotes, cutting lists and app-only specials in one place.\n\n` +
  `Tap your personal link to open it:\n${url}\n\n` +
  `Then "Add to home screen". The link works once and expires in 3 days.`;

/** Internal: create a single-use invite and deliver it over WhatsApp inside the open 24h window. */
export async function sendWhatsAppInvite(ctx: Ctx) {
  const phone = normalizePhone(ctx.body.phone);
  if (!phone || isTestPhone(phone)) throw new HttpError(400, 'invalid_phone');
  if (!(await rateOk('invsend:' + phone, 3600, 5))) throw new HttpError(429, 'rate_limited', 'Too many invites sent to this number. Try again later.');
  if (!(await waWindowOpen(phone))) throw new HttpError(422, 'wa_window_closed', 'This number has not messaged us on WhatsApp in the last 23h. Ask them to send any message first, then resend.');
  const invite = await createInvite(phone, { channel: 'whatsapp-invite' });
  const text = inviteText(maskName(await displayName(phone)), invite.url);
  let err = await waSendImage(phone, INVITE_CARD_URL, text);
  if (err) err = await waSendText(phone, text);
  if (err) throw new HttpError(502, 'wa_send_failed', 'WhatsApp delivery failed (' + err + '). Deliver this link manually: ' + invite.url);
  await event(phone, 'invite_sent', { channel: 'whatsapp' });
  return { ok: true, sent: 'whatsapp', url: invite.url };
}

export async function logout(ctx: Ctx, s: Session) {
  const q = db().from('app_sessions').update({ revoked_at: new Date().toISOString() }).is('revoked_at', null);
  const { error } = ctx.body.all ? await q.eq('user_id', s.user.id) : await q.eq('id', s.id);
  if (error) throw new HttpError(503, 'logout_failed');
  return { ok: true };
}

export function requireInternal(ctx: Ctx) {
  const k = String(ctx.headers['x-internal-key'] || '');
  if (!ENV.INTERNAL_KEY || !safeEqual(k, ENV.INTERNAL_KEY)) throw new HttpError(401, 'unauthorized');
}
