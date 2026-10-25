import { AppUser, Session } from './auth.js';
import { broadcast, db, event, rateOk } from './db.js';
import { ENV } from './env.js';
import { Ctx, HttpError } from './http.js';
import { pushToUser } from './push.js';
import { getQuote } from './quotes.js';
import { metaInbound, OutMsg, PAY_URL_RE, QUOTE_NUM_RE } from './translate.js';
import { log, sha256, waId } from './util.js';

const MSG_COLS = 'id, direction, sender, sender_name, type, body, media_id, media_url, payload, client_id, wa_id, status, bot_status, created_at, read_at';

/** Attach short-lived signed URLs for app-uploaded media. */
export async function hydrate(rows: any[]) {
  const ids = [...new Set(rows.filter(r => r.media_id).map(r => r.media_id))];
  if (!ids.length) return rows;
  const { data: media } = await db().from('app_media').select('id, storage_path, mime, filename, size_bytes').in('id', ids);
  const paths = (media || []).map(m => m.storage_path);
  const { data: signed } = await db().storage.from('app-media').createSignedUrls(paths, 6 * 3600);
  const byPath = new Map((signed || []).map(s => [s.path, s.signedUrl]));
  const byId = new Map((media || []).map(m => [m.id, { ...m, url: byPath.get(m.storage_path) }]));
  return rows.map(r => {
    const m = r.media_id ? byId.get(r.media_id) : null;
    return m ? { ...r, media_url: m.url || r.media_url, payload: { ...r.payload, mime: m.mime, filename: r.payload?.filename || m.filename, size: m.size_bytes } } : r;
  });
}

const preview = (m: { type: string; body?: string | null }) =>
  (m.body || '').trim().slice(0, 140) || ({ image: '📷 Photo', document: '📄 Document', audio: '🎤 Voice note', carousel: '🖼️ Product images', location: '📍 Location' } as any)[m.type] || 'New message';

/** Store an outbound (bot/agent/system) message for an app user, then realtime + push. */
export async function deliverOutbound(user: AppUser, msg: OutMsg, opts: { sender: 'bot' | 'agent' | 'system'; senderName?: string; waId?: string; idempotency?: string; preserveTyping?: boolean; signal?: AbortSignal }) {
  // Recovery callers supply one overall deadline. Abort queries and bound optional fan-out;
  // already-persisted messages are safe to retry through the same idempotency key.
  const signal = opts.signal;
  const query = <T extends { abortSignal(signal: AbortSignal): T }>(q: T): T => signal ? q.abortSignal(signal) : q;
  const bounded = async <T>(work: PromiseLike<T>): Promise<T> => {
    if (!signal) return await work;
    signal.throwIfAborted();
    let rejectAbort: (() => void) | undefined;
    try {
      return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
        rejectAbort = () => reject(signal.reason);
        signal.addEventListener('abort', rejectAbort, { once: true });
      })]);
    } finally { if (rejectAbort) signal.removeEventListener('abort', rejectAbort); }
  };
  signal?.throwIfAborted();
  // Provider callbacks may retry. Namespace keys so clients cannot collide with provider deliveries.
  const clientId = opts.idempotency ? 'server:' + sha256(opts.idempotency) : null;
  if (clientId) {
    const { data } = await bounded(query(db().from('app_messages').select(MSG_COLS).eq('client_id', clientId).eq('phone', user.phone)).maybeSingle());
    if (data) return data;
  }
  // Even a trusted bot may select the wrong document. Check ownership before exposing links.
  const urls = [msg.media_url || '', ...(msg.body || '').match(/https?:\/\/[^\s]+/g) || []];
  for (const raw of urls) {
    let u: URL; try { u = new URL(raw.replace(/[)*]+$/, '')); } catch { continue; }
    const qref = u.pathname.includes('/object/public/hdsquotes/')
      ? decodeURIComponent(u.pathname.split('/').pop() || '').replace(/\.pdf$/i, '')
      : u.hostname === 'hds-nine.vercel.app' && u.pathname.includes('/pay') ? u.searchParams.get('quoteId') : null;
    if (qref && !await bounded(getQuote(user.phone, qref))) throw new HttpError(403, 'document_not_owned');
  }
  const payload: Record<string, any> = { ...msg.payload };
  // enrich: quote card for quote PDFs, pay buttons, quote refs in text
  try {
    const ref = payload.quote_ref;
    if (ref) { const q = await bounded(getQuote(user.phone, ref)); if (q) payload.quote = q; }
    const pays = (msg.body || '').match(PAY_URL_RE);
    if (pays?.length) payload.pay_links = [...new Set(pays)];
    const qrefs = (msg.body || '').replace(/https?:\/\/\S+/g, ' ').match(QUOTE_NUM_RE);
    if (qrefs?.length) {
      // one chip per quote: keep the most specific spelling of each short number
      const byShort = new Map<string, string>();
      for (const r of qrefs) { const k = r.slice(0, 15); if (!byShort.has(k) || r.length > byShort.get(k)!.length) byShort.set(k, r); }
      payload.quote_refs = [...byShort.values()].slice(0, 5);
      // William sometimes names the newly created quote without repeating its PDF URL.
      // Attach only a single unambiguous OWNED quote; figures/PDF come from the engine row, not AI prose.
      if (!payload.quote && payload.quote_refs.length === 1) {
        const q = await bounded(getQuote(user.phone, payload.quote_refs[0]));
        if (q) payload.quote = q;
      }
    }
  } catch (e) { log('enrich_failed', { err: (e as Error).message }); }

  const row = {
    phone: user.phone, direction: 'out', sender: opts.sender, sender_name: opts.senderName || (opts.sender === 'bot' ? 'William' : null),
    type: msg.type, body: msg.body || null, media_url: msg.media_url || null, payload,
    wa_id: opts.waId || waId(), status: 'sent', client_id: clientId,
  };
  signal?.throwIfAborted();
  const { data, error } = await bounded(query(db().from('app_messages').insert(row).select(MSG_COLS)).single());
  if (error) {
    if (error.code === '23505' && clientId) {
      const { data: existing } = await bounded(query(db().from('app_messages').select(MSG_COLS).eq('client_id', clientId).eq('phone', user.phone)).single());
      if (existing) return existing;
    }
    throw new HttpError(500, 'store_failed');
  }
  if (!opts.preserveTyping) await bounded(query(db().from('app_users').update({ typing_until: null }).eq('id', user.id)));
  signal?.throwIfAborted();
  await bounded(broadcast(user.realtime_topic, { type: 'sync' }));
  signal?.throwIfAborted();
  // push: the service worker hides it if the chat is open and focused
  await bounded(pushToUser(user.id, {
    title: opts.sender === 'agent' ? (opts.senderName || 'HDS team') : 'William — HDS',
    body: preview(msg), url: '/', tag: 'chat',
  }).catch(() => {}));
  return data;
}

function cursorTime(value: string | null) {
  if (!value) return null;
  if (!/^[0-9T:Z+.\-]{20,35}$/.test(value) || !Number.isFinite(Date.parse(value))) throw new HttpError(400, 'invalid_cursor');
  return value;
}
function cursorId(value: string | null) {
  if (!value) return null;
  const v = value.replace(/^wa-/, '');
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)) throw new HttpError(400, 'invalid_cursor');
  return v;
}
export async function listMessages(ctx: Ctx, s: Session) {
  const limit = Math.max(1, Math.min(Math.floor(Number(ctx.query.get('limit'))) || 80, 200));
  const after = cursorTime(ctx.query.get('after')), before = cursorTime(ctx.query.get('before'));
  const aid = cursorId(ctx.query.get('after_id')), bid = cursorId(ctx.query.get('before_id'));
  let q = db().from('app_messages').select(MSG_COLS).eq('phone', s.user.phone)
    .order('created_at', { ascending: !!after }).order('id', { ascending: !!after }).limit(limit + 1);
  if (after) q = aid ? q.or(`created_at.gt.${after},and(created_at.eq.${after},id.gt.${aid})`) : q.gte('created_at', after);
  if (before) q = bid ? q.or(`created_at.lt.${before},and(created_at.eq.${before},id.lt.${bid})`) : q.lt('created_at', before);
  const { data, error } = await q;
  if (error) throw new HttpError(503, 'messages_unavailable');
  const rows = (data || []).slice(0, limit); if (!after) rows.reverse();
  const last = rows[rows.length - 1];
  const { data: user } = await db().from('app_users').select('typing_until').eq('id', s.user.id).single();
  return { messages: await hydrate(rows), typing_until: user?.typing_until || null,
    has_more: (data || []).length > limit, next_cursor: last ? {created_at: last.created_at, id: last.id} : null };
}

/** Earlier WhatsApp conversation (read-only), from the bot's own log. */
export async function waHistory(ctx: Ctx, s: Session) {
  const before = cursorTime(ctx.query.get('before'));
  const bid = cursorId(ctx.query.get('before_id'));
  let q = db().from('ai_conversations')
    .select('id, role, message_text, sender_name, created_at, attachment_url, attachment_type, attachment_name, image_url, tool_results')
    .eq('phone_number', s.user.phone).in('role', ['user', 'assistant']).lt('created_at', s.user.wa_history_cutoff)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
  if (before) q = bid ? q.or(`created_at.lt.${before},and(created_at.eq.${before},id.lt.${bid})`) : q.lt('created_at', before);
  const { data, error } = await q;
  if (error) throw new HttpError(503, 'history_unavailable');
  const rows = (data || []).filter(r => !(r.tool_results as any)?.automatic_internal).map(r => {
    const src = (r.tool_results as any)?.source;
    return {
      id: 'wa-' + r.id, created_at: r.created_at, direction: r.role === 'user' ? 'in' : 'out',
      sender: r.role === 'user' ? 'customer' : src === 'chatwoot_reply_bridge' ? 'agent' : 'bot',
      sender_name: r.role === 'user' ? null : src === 'chatwoot_reply_bridge' ? r.sender_name : 'William',
      type: 'text', body: (r.message_text || '').replace(/\[IMAGE ANALYSIS:[\s\S]*$/i, '').trim() || (r.attachment_name ? `📎 ${r.attachment_name}` : '📷 Photo'),
      media_url: null, payload: { channel: 'whatsapp' }, status: 'read',
    };
  }).reverse();
  return { messages: rows, has_more: (data || []).length === 100 };
}

const ALLOWED_IN = new Set(['text', 'image', 'document', 'audio', 'location', 'interactive']);

/** Customer sends a message: idempotent on client_id, then forwarded to William as a Meta webhook. */
export async function customerSend(ctx: Ctx, s: Session) {
  const b = ctx.body || {};
  const clientId = typeof b.client_id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.client_id) ? b.client_id : null;
  if (!clientId) throw new HttpError(400, 'client_id_required');
  const type = String(b.type || 'text');
  if (!ALLOWED_IN.has(type)) throw new HttpError(400, 'bad_type');
  const text = typeof b.body === 'string' ? b.body : '';
  if (text.length > 4096) throw new HttpError(400, 'message_too_long', 'Please split your message or attach a document. Messages are limited to 4,096 characters.');
  if ((type === 'text' || type === 'interactive') && !text.trim()) throw new HttpError(400, 'empty');

  const { data: dup } = await db().from('app_messages').select(MSG_COLS + ', phone').eq('client_id', clientId).maybeSingle();
  if (dup) {
    const { phone: dupPhone, ...rest } = dup as any;
    if (dupPhone !== s.user.phone) throw new HttpError(409, 'conflict');
    return { message: (await hydrate([rest]))[0], duplicate: true };
  }

  if (!(await rateOk('send:' + s.user.phone, 60, 30))) throw new HttpError(429, 'rate_limited', 'You are sending messages too fast.');

  let media: any = null;
  if (['image', 'document', 'audio'].includes(type)) {
    const { data } = await db().from('app_media').select('*').eq('id', String(b.media_id || '')).eq('phone', s.user.phone).maybeSingle();
    if (!data) throw new HttpError(400, 'media_missing');
    const { data: info, error: storageError } = await db().storage.from('app-media').info(data.storage_path);
    if (storageError || !info) throw new HttpError(400, 'media_not_uploaded');
    if (!info.size || info.size > 25 * 1024 * 1024 || info.size !== data.size_bytes || info.contentType?.split(';')[0] !== data.mime) throw new HttpError(400, 'media_mismatch');
    if ((type === 'image' && !data.mime.startsWith('image/')) || (type === 'audio' && !data.mime.startsWith('audio/'))) throw new HttpError(400, 'media_mismatch');
    media = data;
  }
  const location = type === 'location' && typeof b.location?.lat === 'number' && typeof b.location?.lon === 'number'
    && Number.isFinite(b.location.lat) && Number.isFinite(b.location.lon) && Math.abs(b.location.lat) <= 90 && Math.abs(b.location.lon) <= 180
    ? { lat: b.location.lat, lon: b.location.lon, name: String(b.location.name || '').slice(0, 120), address: String(b.location.address || '').slice(0, 200) } : null;
  if (type === 'location' && !location) throw new HttpError(400, 'bad_location');

  const id = waId();
  const row = {
    phone: s.user.phone, direction: 'in', sender: 'customer', type, body: text || null,
    media_id: media?.id || null, payload: { ...(media ? { filename: media.filename, mime: media.mime } : {}), ...(location ? { location } : {}), ...(type === 'interactive' ? { button: text } : {}), ...(b.reply_to ? { reply_to: String(b.reply_to).slice(0, 80) } : {}), ...(b.reply_preview ? { reply_preview: String(b.reply_preview).slice(0, 160) } : {}) },
    client_id: clientId, wa_id: id, status: 'sent', bot_status: 'pending',
  };
  const { data: saved, error } = await db().from('app_messages').insert(row).select(MSG_COLS).single();
  if (error) {
    if (error.code === '23505') {
      const { data: again } = await db().from('app_messages').select(MSG_COLS).eq('client_id', clientId).eq('phone', s.user.phone).maybeSingle();
      if (!again) throw new HttpError(409, 'conflict');
      return { message: (await hydrate([again]))[0], duplicate: true };
    }
    throw new HttpError(500, 'store_failed', error.message);
  }
  if (!s.user.name && typeof b.name === 'string') await db().from('app_users').update({ name: b.name.slice(0, 80) }).eq('id', s.user.id);

  const ok = await forwardToBot(s.user, saved, media, location);
  const status = ok ? 'delivered' : 'sent';
  // A fast bot may have already marked this read; acknowledgement must never downgrade it.
  await db().from('app_messages').update({ status, delivered_at: ok ? new Date().toISOString() : null }).eq('id', saved.id).eq('status', 'sent');
  await db().from('app_messages').update({ bot_status: ok ? 'forwarded' : 'failed' }).eq('id', saved.id).eq('bot_status', 'pending');
  await event(s.user.phone, 'message_sent', { type, forwarded: ok });
  const { data: current } = await db().from('app_messages').select(MSG_COLS).eq('id', saved.id).single();
  return { message: (await hydrate([current || saved]))[0] };
}

export async function forwardToBot(user: AppUser, m: any, media: any, location: any): Promise<boolean> {
  const payload = metaInbound({
    phone: user.phone, name: user.name || user.phone, waId: m.wa_id,
    type: m.type, text: m.body || '', mediaId: media?.id, mime: media?.mime, filename: media?.filename, location,
    buttonTitle: m.type === 'interactive' ? m.body : undefined,
    replyTo: typeof m.payload?.reply_to === 'string' ? m.payload.reply_to : undefined,
    replyPreview: typeof m.payload?.reply_preview === 'string' ? m.payload.reply_preview : undefined,
    phoneNumberId: ENV.APP_PHONE_NUMBER_ID, displayNumber: ENV.APP_DISPLAY_NUMBER,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(ENV.N8N_APP_WEBHOOK_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hds-app-key': ENV.N8N_APP_KEY },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) return true;
      log('bot_forward_http', { status: r.status, attempt });
    } catch (e) { log('bot_forward_err', { err: (e as Error).message, attempt }); }
    await new Promise(r => setTimeout(r, 800));
  }
  return false;
}

/** Retry messages whose hand-off to the bot failed (called on app open / by the client). */
export async function retryPending(s: Session) {
  const { data } = await db().from('app_messages').select('*').eq('phone', s.user.phone).eq('bot_status', 'failed')
    .gt('created_at', new Date(Date.now() - 6 * 3600_000).toISOString()).order('created_at').limit(5);
  let n = 0;
  for (const m of data || []) {
    // A transport failure is retryable only before William claimed the turn. After a claim,
    // quoting/payment tools may already have run; never replay them blindly after a workflow error.
    const { data: claim, error: claimError } = await db().from('app_turn_claims').select('message_id').eq('message_id', m.id).maybeSingle();
    if (claimError || claim) continue;
    const media = m.media_id ? (await db().from('app_media').select('*').eq('id', m.media_id).single()).data : null;
    const ok = await forwardToBot(s.user, m, media, m.payload?.location || null);
    if (ok) {
      n++;
      await db().from('app_messages').update({ bot_status: 'forwarded' }).eq('id', m.id).eq('bot_status', 'failed');
      await db().from('app_messages').update({ status: 'delivered', delivered_at: new Date().toISOString() }).eq('id', m.id).eq('status', 'sent');
    }
  }
  return { retried: n };
}
