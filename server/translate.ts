// Pure translation of WhatsApp Cloud API "send message" bodies into app messages.
// Kept dependency-free so it is unit-tested against the exact payloads William's nodes send.

export interface OutMsg {
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'carousel' | 'location' | 'template' | 'system';
  body: string;
  media_url?: string | null;
  payload: Record<string, any>;
}
export type Translated =
  | { kind: 'message'; to: string; msg: OutMsg }
  | { kind: 'read'; message_id: string; typing: boolean }
  | { kind: 'ignore'; reason: string };

export const QUOTE_PDF_RE = /https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/hdsquotes\/([A-Za-z0-9&%\-_.]+)/i;
export const PAY_URL_RE = /https:\/\/hds-nine\.vercel\.app\/api\/(?:pay|payfast\/pay)\?[^\s)*]+/gi;
export const QUOTE_NUM_RE = /\bQ-20\d{6}-\d{4}(?:-[A-Za-z0-9&]+)*/g;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function buttonsFromAction(action: any): { quick_replies?: string[]; buttons?: { text: string; url: string }[] } {
  if (!action) return {};
  if (action.name === 'cta_url' && action.parameters?.url)
    return { buttons: [{ text: str(action.parameters.display_text) || 'Open', url: str(action.parameters.url) }] };
  if (Array.isArray(action.buttons))
    return { quick_replies: action.buttons.map((b: any) => str(b?.reply?.title || b?.title)).filter(Boolean) };
  if (Array.isArray(action.sections))
    return { quick_replies: action.sections.flatMap((s: any) => (s.rows || []).map((r: any) => str(r.title))).filter(Boolean).slice(0, 10) };
  return {};
}

export function translateOutbound(b: any): Translated {
  if (!b || typeof b !== 'object') return { kind: 'ignore', reason: 'empty' };
  if (b.status === 'read' && b.message_id) return { kind: 'read', message_id: str(b.message_id), typing: !!b.typing_indicator };
  const to = str(b.to).replace(/\D/g, '');
  if (!to) return { kind: 'ignore', reason: 'no_to' };
  const t = str(b.type) || 'text';
  const m = (msg: OutMsg): Translated => ({ kind: 'message', to, msg });

  switch (t) {
    case 'text':
      return m({ type: 'text', body: str(b.text?.body), payload: {} });
    case 'image':
      return m({ type: 'image', body: str(b.image?.caption), media_url: str(b.image?.link) || null, payload: {} });
    case 'video':
      return m({ type: 'video', body: str(b.video?.caption), media_url: str(b.video?.link) || null, payload: {} });
    case 'audio':
      return m({ type: 'audio', body: '', media_url: str(b.audio?.link) || null, payload: {} });
    case 'document': {
      const link = str(b.document?.link);
      const qm = link.match(QUOTE_PDF_RE);
      return m({
        type: 'document', body: str(b.document?.caption), media_url: link || null,
        payload: { filename: str(b.document?.filename) || 'document.pdf', ...(qm ? { quote_ref: decodeURIComponent(qm[1]).replace(/\.pdf$/i, '') } : {}) },
      });
    }
    case 'location':
      return m({ type: 'location', body: str(b.location?.name), payload: { lat: b.location?.latitude, lon: b.location?.longitude, address: str(b.location?.address) } });
    case 'template':
      return m({ type: 'template', body: '', payload: { template: b.template || {} } });
    case 'interactive': {
      const it = b.interactive || {};
      const bodyText = str(it.body?.text);
      const header = it.header?.type === 'text' ? str(it.header.text) : '';
      const footer = str(it.footer?.text);
      if (it.type === 'carousel') {
        const cards = (it.action?.cards || []).map((c: any) => ({
          image: str(c.header?.image?.link) || str(c.header?.video?.link) || null,
          text: str(c.body?.text),
          ...buttonsFromAction(c.action),
        }));
        return m({ type: 'carousel', body: bodyText, payload: { cards } });
      }
      const headerImage = it.header?.type === 'image' ? str(it.header.image?.link) : '';
      return m({
        type: headerImage ? 'image' : 'text', media_url: headerImage || null,
        body: [header, bodyText].filter(Boolean).join('\n'),
        payload: { footer: footer || undefined, ...buttonsFromAction(it.action) },
      });
    }
    case 'reaction':
      return { kind: 'ignore', reason: 'reaction' };
    default:
      return m({ type: 'text', body: str(b[t]?.body) || '', payload: { unsupported_type: t } });
  }
}

/** Render a WhatsApp template from its mirrored body text ({{1}} … placeholders). */
export function renderTemplate(bodyText: string, template: any): string {
  const params: string[] = [];
  for (const c of template?.components || []) {
    if (String(c.type).toLowerCase() === 'body') for (const p of c.parameters || []) params.push(str(p.text ?? p?.currency?.fallback_value ?? p?.date_time?.fallback_value));
  }
  return (bodyText || '').replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? '');
}

/** Meta-format inbound webhook body that William's "Extract Meta Payload" node parses unchanged. */
export function metaInbound(opts: {
  phone: string; name: string; waId: string; type: string; text?: string; mediaId?: string; mime?: string;
  filename?: string; location?: { lat: number; lon: number; name?: string; address?: string } | null;
  buttonTitle?: string; phoneNumberId: string; displayNumber: string;
}) {
  const msg: any = { from: opts.phone, id: opts.waId, timestamp: String(Math.floor(Date.now() / 1000)), type: opts.type };
  if (opts.type === 'text') msg.text = { body: opts.text || '' };
  else if (opts.type === 'image') msg.image = { id: opts.mediaId, mime_type: opts.mime, caption: opts.text || undefined };
  else if (opts.type === 'document') msg.document = { id: opts.mediaId, mime_type: opts.mime, filename: opts.filename || 'document', caption: opts.text || undefined };
  else if (opts.type === 'audio') msg.audio = { id: opts.mediaId, mime_type: opts.mime, voice: true };
  else if (opts.type === 'location' && opts.location) msg.location = { latitude: opts.location.lat, longitude: opts.location.lon, name: opts.location.name, address: opts.location.address };
  else if (opts.type === 'interactive') msg.interactive = { type: 'button_reply', button_reply: { id: 'qr', title: opts.buttonTitle || opts.text || '' } };
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'hds-app', changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: opts.displayNumber, phone_number_id: opts.phoneNumberId },
          contacts: [{ profile: { name: opts.name || opts.phone }, wa_id: opts.phone }],
          messages: [msg],
        },
      }],
    }],
  };
}
