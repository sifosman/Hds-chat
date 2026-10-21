// Staff replies from the Chatwoot "HDS App" API inbox → the customer's app (mirrors HDS Chatwoot Reply Bridge,
// which only serves WhatsApp inbox 3). Logged to ai_conversations the same way so William sees staff messages.
import { AppUser } from './auth.js';
import { db } from './db.js';
import { ENV } from './env.js';
import { Ctx, HttpError } from './http.js';
import { deliverOutbound } from './messages.js';
import { log, normalizePhone, safeEqual, sha256 } from './util.js';

export async function chatwootWebhook(ctx: Ctx) {
  if (!ENV.CHATWOOT_WEBHOOK_SECRET || !safeEqual(ctx.params.secret, ENV.CHATWOOT_WEBHOOK_SECRET)) throw new HttpError(404, 'not_found');
  const b = ctx.body || {};
  const inboxId = String(b.inbox?.id ?? b.inbox_id ?? b.conversation?.inbox_id ?? '');
  if (b.event !== 'message_created') return { skipped: 'event' };
  if (!(b.message_type === 'outgoing' || b.message_type === 1 || b.message_type === '1')) return { skipped: 'not_outgoing' };
  if (b.private === true || b.private === 'true') return { skipped: 'private' };
  if (!ENV.CHATWOOT_APP_INBOX_ID || inboxId !== ENV.CHATWOOT_APP_INBOX_ID) return { skipped: 'inbox' };
  if (String(b.account?.id || b.conversation?.account_id || '') !== ENV.CHATWOOT_ACCOUNT_ID) return { skipped: 'account' };
  if (!b.id) throw new HttpError(400, 'message_id_required');
  // messages the API itself created on behalf of the bot carry content_attributes.hds_bot
  if (b.content_attributes?.hds_bot) return { skipped: 'bot_echo' };

  const contact = b.conversation?.meta?.sender || b.sender?.type === 'contact' && b.sender || b.contact || {};
  const phone = normalizePhone(contact.phone_number || '');
  if (!phone) return { skipped: 'no_phone' };
  const { data: user } = await db().from('app_users').select('*').eq('phone', phone).maybeSingle();
  if (!user || user.status !== 'active') return { skipped: 'not_app_user' };
  const agentName = b.sender?.available_name || b.sender?.name || 'HDS team';
  const content = typeof b.content === 'string' ? b.content : '';
  const atts = (Array.isArray(b.attachments) ? b.attachments : []).filter((a: any) => a?.data_url);

  const sent: any[] = [];
  if (content.trim()) {
    await deliverOutbound(user as AppUser, { type: 'text', body: content, payload: { chatwoot_message_id: b.id } }, { sender: 'agent', senderName: agentName, idempotency: `cw:${inboxId}:${b.id}:text` });
    sent.push({ type: 'text' });
  }
  for (const a of atts) {
    const isImg = a.file_type === 'image' || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(a.data_url);
    const fname = a.file_name || decodeURIComponent(String(a.data_url).split('/').pop()?.split('?')[0] || 'file');
    await deliverOutbound(user as AppUser, { type: isImg ? 'image' : 'document', body: '', media_url: a.data_url, payload: { filename: fname } }, { sender: 'agent', senderName: agentName, idempotency: `cw:${inboxId}:${b.id}:attachment:${a.id || atts.indexOf(a)}` });
    sent.push({ type: isImg ? 'image' : 'document', file: fname });
  }
  const h = sha256(`hds-app-cw-log:${inboxId}:${b.id}`).slice(0,32);
  const logId = `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  const { error: logError } = await db().from('ai_conversations').upsert({
    id: logId, phone_number: phone, role: 'assistant', sender_name: agentName,
    message_text: content || ('[attachments sent] ' + sent.filter(s => s.file).map(s => s.file).join(', ')),
    tool_results: { source: 'chatwoot_reply_bridge', channel: 'app', agent: agentName, conversation_id: b.conversation?.id, sent },
    conversation_metadata: { channel: 'app', chatwoot_message_id: b.id },
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (logError) throw new HttpError(503, 'staff_context_log_failed');
  log('chatwoot_relayed', { phone, n: sent.length });
  return { ok: true, sent: sent.length };
}
