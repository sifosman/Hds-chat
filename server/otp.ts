// OTP delivery chain. Order: SMS (if a provider is configured) → WhatsApp → email on file (Brevo).
// WhatsApp sends exactly one message: free-form inside the customer's open 24h window, else the
// approved hds_app_otp AUTHENTICATION template (also tried if a free-form send fails mid-window).
import { db } from './db.js';
import { ENV, isTestPhone } from './env.js';
import { log } from './util.js';

type R = { ok: true; channel: string } | { ok: false; reasons: string[]; message: string };

const text = (code: string) => `${code} is your HDS app sign-in code. It expires in 10 minutes. Don't share it with anyone.`;

async function viaSms(phone: string, code: string): Promise<string | null> {
  if (!ENV.SMS_PROVIDER || !ENV.SMS_USER || !ENV.SMS_PASS) return 'sms_not_configured';
  const auth = 'Basic ' + Buffer.from(`${ENV.SMS_USER}:${ENV.SMS_PASS}`).toString('base64');
  let r: Response;
  if (ENV.SMS_PROVIDER === 'smsportal') {
    // SMSPortal REST: client id/secret basic auth → bearer token → BulkMessages
    const t = await fetch('https://rest.smsportal.com/Authentication', { headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) });
    if (!t.ok) return 'sms_auth_' + t.status;
    const { token } = await t.json() as any;
    if (typeof token !== 'string' || !token) return 'sms_auth_invalid';
    r = await fetch('https://rest.smsportal.com/BulkMessages', {
      method: 'POST', signal: AbortSignal.timeout(10_000), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ content: text(code), destination: phone }] }),
    });
  } else if (ENV.SMS_PROVIDER === 'bulksms') {
    r = await fetch('https://api.bulksms.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(10_000), headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: '+' + phone, body: text(code), from: ENV.SMS_SENDER || undefined }),
    });
  } else return 'sms_provider_unknown';
  return r.ok ? null : 'sms_http_' + r.status;
}

/** True when the customer has messaged us on WhatsApp in the last 23h (free-form window). */
export async function waWindowOpen(phone: string): Promise<boolean> {
  const { data, error } = await db().from('ai_conversations').select('created_at')
    .eq('phone_number', phone).eq('role', 'user').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const age = Date.now() - Date.parse(data?.created_at);
  return !error && !!data && Number.isFinite(age) && age >= 0 && age < 23 * 3600_000;
}

/** Free-form WhatsApp text via the Cloud API. Returns null on success, else a reason code. */
export async function waSendText(phone: string, body: string): Promise<string | null> {
  if (!ENV.WA_TOKEN || !ENV.WA_PHONE_ID) return 'wa_not_configured';
  const r = await fetch(`https://graph.facebook.com/v20.0/${ENV.WA_PHONE_ID}/messages`, {
    method: 'POST', signal: AbortSignal.timeout(10_000), headers: { Authorization: 'Bearer ' + ENV.WA_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body } }),
  });
  return r.ok ? null : 'wa_http_' + r.status;
}

/** Free-form WhatsApp image + caption via the Cloud API. Returns null on success, else a reason code. */
export async function waSendImage(phone: string, link: string, caption: string): Promise<string | null> {
  return waSendMedia(phone, 'image', link, caption);
}

/** Free-form WhatsApp video + caption via the Cloud API. A short muted mp4 plays like a GIF in-chat. */
export async function waSendVideo(phone: string, link: string, caption: string): Promise<string | null> {
  return waSendMedia(phone, 'video', link, caption);
}

async function waSendMedia(phone: string, type: 'image' | 'video', link: string, caption: string): Promise<string | null> {
  if (!ENV.WA_TOKEN || !ENV.WA_PHONE_ID) return 'wa_not_configured';
  const r = await fetch(`https://graph.facebook.com/v20.0/${ENV.WA_PHONE_ID}/messages`, {
    method: 'POST', signal: AbortSignal.timeout(10_000), headers: { Authorization: 'Bearer ' + ENV.WA_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type, [type]: { link, caption } }),
  });
  return r.ok ? null : 'wa_http_' + r.status;
}

/** Approved AUTHENTICATION template — delivers outside the 24h window (copy-code button carries the OTP). */
async function waSendOtpTemplate(phone: string, code: string): Promise<string | null> {
  if (!ENV.WA_TOKEN || !ENV.WA_PHONE_ID || !ENV.WA_OTP_TEMPLATE) return 'wa_tpl_not_configured';
  const r = await fetch(`https://graph.facebook.com/v20.0/${ENV.WA_PHONE_ID}/messages`, {
    method: 'POST', signal: AbortSignal.timeout(10_000), headers: { Authorization: 'Bearer ' + ENV.WA_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: phone, type: 'template',
      template: {
        name: ENV.WA_OTP_TEMPLATE, language: { code: 'en_US' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          // the copy-code OTP button takes its value like a URL-button parameter
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
  });
  return r.ok ? null : 'wa_tpl_http_' + r.status;
}

async function viaWhatsApp(phone: string, code: string): Promise<string | null> {
  if (!ENV.WA_TOKEN || !ENV.WA_PHONE_ID) return 'wa_not_configured';
  if (await waWindowOpen(phone)) {
    try { if (!(await waSendText(phone, text(code)))) return null; } catch { /* fall through to the template */ }
  }
  // Closed window (or the free-form send raced/failed it): the template is the fallback.
  return waSendOtpTemplate(phone, code);
}

async function viaEmail(phone: string, code: string): Promise<string | null> {
  // An email written into CRM by a conversation is not proof of ownership of this phone.
  // Email sign-in stays disabled until a separately verified identity-link flow exists.
  return 'email_identity_not_verified';
  /* Future verified-email provider:
  if (!ENV.BREVO_API_KEY) return 'email_not_configured';
  const { data, error } = await db().from('customer_profiles').select('email').eq('phone_number', phone).maybeSingle();
  const email = !error && typeof data?.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ? data.email : null;
  if (!email) return 'no_email';
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', signal: AbortSignal.timeout(10_000), headers: { 'api-key': ENV.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { email: ENV.EMAIL_FROM, name: 'HDS Group' }, to: [{ email }], subject: 'Your HDS sign-in code', textContent: text(code) }),
  });
  return r.ok ? null : 'email_http_' + r.status;
  */
}

const CHANNELS: Record<string, (p: string, c: string) => Promise<string | null>> = { sms: viaSms, whatsapp: viaWhatsApp, email: viaEmail };

export async function deliverOtp(phone: string, code: string, preferred?: string): Promise<R> {
  // Synthetic numbers must never reach any provider, including direct callers/tests.
  if (isTestPhone(phone) || !/^[1-9]\d{9,14}$/.test(phone) || !/^\d{6}$/.test(code)) {
    return { ok: false, reasons: ['invalid_destination'], message: 'Unable to send a code.' };
  }
  const order = ['sms', 'whatsapp', 'email'];
  if (preferred && CHANNELS[preferred]) order.sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
  const reasons: string[] = [];
  for (const ch of order) {
    try {
      const err = await CHANNELS[ch](phone, code);
      if (!err) { log('otp_delivered', { phone, ch }); return { ok: true, channel: ch }; }
      reasons.push(err);
    } catch (e) { reasons.push(ch + '_error'); }
  }
  log('otp_failed', { phone, reasons });
  return {
    ok: false, reasons,
    message: 'We couldn\'t send you a code right now. Send us any WhatsApp message on 078 706 0895, then tap "Send code" again and we\'ll send the code to your WhatsApp.',
  };
}
