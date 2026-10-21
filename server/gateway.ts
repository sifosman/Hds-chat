// WhatsApp Cloud API–compatible gateway. The generated n8n "HDS App Channel" workflow calls
//   https://<app>/api/wa/<GATEWAY_SECRET>/v20.0/<phoneId>/messages   (instead of graph.facebook.com)
//   https://<app>/api/wa/<GATEWAY_SECRET>/v21.0/<mediaId>
// App users get the message in-app; anyone else (branch managers etc.) is proxied to the real Graph API.
import { AppUser } from './auth.js';
import { broadcast, db, rateOk } from './db.js';
import { ENV } from './env.js';
import { Ctx, HttpError, send } from './http.js';
import { deliverOutbound } from './messages.js';
import { renderTemplate, translateOutbound } from './translate.js';
import { log, safeEqual, sha256, waId } from './util.js';
import { finishTurn } from './turns.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function appUserByPhone(phone: string): Promise<AppUser | null> {
  const { data } = await db().from('app_users').select('*').eq('phone', phone).maybeSingle();
  return (data as AppUser) || null;
}

async function proxy(ctx: Ctx, rest: string) {
  const qs = ctx.query.toString();
  const r = await fetch(`https://graph.facebook.com/${rest}${qs ? '?' + qs : ''}`, {
    method: ctx.method,
    headers: { Authorization: String(ctx.headers.authorization || ''), 'Content-Type': 'application/json' },
    body: ctx.method === 'GET' ? undefined : ctx.rawBody,
  });
  const text = await r.text();
  log('gateway_proxy', { status: r.status, rest: rest.replace(/\d{6,}/g, '#') });
  ctx.res.statusCode = r.status;
  ctx.res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
  ctx.res.end(text);
}

export async function gateway(ctx: Ctx) {
  if (!ENV.GATEWAY_SECRET || !safeEqual(ctx.params.secret, ENV.GATEWAY_SECRET)) throw new HttpError(404, 'not_found');
  const rest = ctx.params.rest || '';

  // raw file for the bot's download step
  const fm = rest.match(/^file\/([0-9a-f-]{36})$/i);
  if (fm && ctx.method === 'GET') return serveFile(ctx, fm[1]);

  const mm = rest.match(/^v\d+\.\d+\/([^/]+)\/messages$/);
  if (mm && ctx.method === 'POST') {
    const t = translateOutbound(ctx.body);
    if (t.kind === 'ignore') return { messaging_product: 'whatsapp', messages: [{ id: waId() }], ignored: t.reason };
    if (t.kind === 'read') {
      const { data: m } = await db().from('app_messages').select('id, phone').eq('wa_id', t.message_id).maybeSingle();
      if (!m) return { success: true, ignored: 'unknown_message' };
      await db().from('app_messages').update({ status: 'read', read_at: new Date().toISOString() }).eq('id', m.id).neq('status', 'read');
      const user = await appUserByPhone(m.phone);
      if (user && user.status === 'active') {
        if (t.typing) await db().from('app_users').update({ typing_until: new Date(Date.now() + 180_000).toISOString() }).eq('id', user.id);
        await broadcast(user.realtime_topic, { type: 'sync' });
      }
      return { success: true };
    }
    const user = await appUserByPhone(t.to);
    if (!user) {
      // Never turn an unknown customer recipient into a real WhatsApp send.
      // Only canonical active branch numbers may leave this isolated app channel.
      const { data: branches, error } = await db().from('branches').select('whatsapp').eq('is_active', true);
      const isBranch = !error && (branches || []).some(b => {
        let p = String(b.whatsapp || '').replace(/\D/g, '');
        if (p.startsWith('0')) p = '27' + p.slice(1);
        return p === t.to;
      });
      if (!isBranch) throw new HttpError(403, 'recipient_not_allowed');
      return proxy(ctx, rest);
    }
    if (user.status !== 'active') throw new HttpError(403, 'recipient_blocked');
    const msg = t.msg;
    if (msg.type === 'template') {
      const name = msg.payload.template?.name;
      const { data: tpl } = await db().from('wa_templates').select('body_text, header_text').eq('name', name).limit(1).maybeSingle();
      msg.type = 'text';
      msg.body = [tpl?.header_text, renderTemplate(tpl?.body_text || '', msg.payload.template)].filter(Boolean).join('\n') || `(${name})`;
    }
    const id = waId();
    const key = String(ctx.headers['x-hds-delivery-key'] || '').slice(0, 500);
    const finalExecution = key.match(/^(\d+):Send WhatsApp Reply:\d+$/)?.[1];
    if (finalExecution) {
      const { data: claim, error } = await db().from('app_turn_claims').select('message_id,app_messages!inner(phone)').eq('execution_id', finalExecution).maybeSingle();
      if (error || !claim || (claim as any).app_messages?.phone !== user.phone) throw new HttpError(403, 'turn_recipient_mismatch');
    }
    // A lost HTTP response must not turn the final PDF -> text fallback into two customer messages.
    const deliveryId = finalExecution ? `bot:${user.id}:${finalExecution}:final-reply` : key ? `bot:${user.id}:${key}:${sha256(ctx.rawBody)}` : undefined;
    const delivered = await deliverOutbound(user, msg, { sender: 'bot', waId: id, idempotency: deliveryId });
    if (finalExecution) {
      // Only after a proven durable insert. The terminal workflow callback retries bookkeeping if needed.
      try { await finishTurn(finalExecution, 'completed'); } catch { log('turn_completion_deferred'); }
    }
    log('gateway_delivered', { type: msg.type });
    return { messaging_product: 'whatsapp', contacts: [{ input: t.to, wa_id: t.to }], messages: [{ id: delivered.wa_id }] };
  }

  const media = rest.match(/^v\d+\.\d+\/([^/?]+)$/);
  if (media && ctx.method === 'GET' && UUID_RE.test(media[1])) {
    const { data: m } = await db().from('app_media').select('*').eq('id', media[1]).maybeSingle();
    if (!m) throw new HttpError(404, 'media_not_found');
    // Download directly from private storage: do not proxy 25 MB files through Vercel's response limit.
    const { data: signed, error } = await db().storage.from('app-media').createSignedUrl(m.storage_path, 900);
    if (error || !signed) throw new HttpError(503, 'media_unavailable');
    return {
      messaging_product: 'whatsapp', id: m.id, mime_type: m.mime, file_size: m.size_bytes, sha256: '',
      url: signed.signedUrl,
    };
  }
  throw new HttpError(404, 'not_found');
}

async function serveFile(ctx: Ctx, id: string) {
  const { data: m } = await db().from('app_media').select('*').eq('id', id).maybeSingle();
  if (!m) throw new HttpError(404, 'media_not_found');
  const { data: blob, error } = await db().storage.from('app-media').download(m.storage_path);
  if (error || !blob) throw new HttpError(404, 'media_not_found');
  const buf = Buffer.from(await blob.arrayBuffer());
  ctx.res.statusCode = 200;
  ctx.res.setHeader('Content-Type', m.mime);
  ctx.res.setHeader('Content-Length', String(buf.length));
  ctx.res.end(buf);
}

// ---------------- customer media upload ----------------
const MIME_OK = /^(image\/(jpeg|png|webp|heic|heif|gif)|audio\/(ogg|webm|wav|x-wav|mpeg|mp4|aac|m4a|x-m4a)|application\/pdf|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel)|text\/(csv|plain))$/;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'application/pdf': 'pdf' };

export async function uploadUrl(ctx: Ctx, phone: string) {
  if (!(await rateOk('upload:' + phone, 3600, 60))) throw new HttpError(429, 'rate_limited');
  const mime = String(ctx.body.mime || '').split(';')[0].trim().toLowerCase();
  const size = Number(ctx.body.size) || 0;
  if (!MIME_OK.test(mime)) throw new HttpError(400, 'unsupported_file', 'That file type is not supported.');
  if (size <= 0 || size > 25 * 1024 * 1024) throw new HttpError(400, 'file_too_large', 'Files must be under 25 MB.');
  const filename = String(ctx.body.filename || 'file').replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  const ext = EXT[mime] || (filename.match(/\.(\w{1,5})$/)?.[1] || 'bin');
  const { data: row, error } = await db().from('app_media').insert({ phone, storage_path: 'pending', mime, size_bytes: size, filename }).select('id').single();
  if (error) throw new HttpError(500, 'media_failed', error.message);
  const path = `${phone}/${row.id}.${ext}`;
  const { data: signed, error: e2 } = await db().storage.from('app-media').createSignedUploadUrl(path);
  if (e2 || !signed) throw new HttpError(500, 'media_failed', e2?.message);
  await db().from('app_media').update({ storage_path: path }).eq('id', row.id);
  return { media_id: row.id, upload_url: signed.signedUrl, path };
}

export { send };
