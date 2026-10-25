export const URL_RE = /(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,!?;:*_~])/g;
const MARKUP_RE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```)/g;

export type Segment = { kind: 'text' | 'bold' | 'italic' | 'strike' | 'mono' | 'link'; text: string };

/** WhatsApp markup + URL splitting: *bold* _italic_ ~strike~ ```mono``` and links. */
export function richSegments(text: string): Segment[] {
  const out: Segment[] = [];
  const parts = text.split(URL_RE);
  parts.forEach((p, i) => {
    if (!p) return;
    if (i % 2 === 1) { out.push({ kind: 'link', text: p }); return; }
    let last = 0, m: RegExpExecArray | null;
    const re = new RegExp(MARKUP_RE.source, 'g');
    while ((m = re.exec(p))) {
      if (m.index > last) out.push({ kind: 'text', text: p.slice(last, m.index) });
      const t = m[0];
      const inner = t.startsWith('```') ? t.slice(3, -3) : t.slice(1, -1);
      out.push({ kind: t[0] === '*' ? 'bold' : t[0] === '_' ? 'italic' : t[0] === '~' ? 'strike' : 'mono', text: inner });
      last = m.index + t.length;
    }
    if (last < p.length) out.push({ kind: 'text', text: p.slice(last) });
  });
  return out;
}

export function shortUrl(u: string) {
  try {
    const x = new URL(u);
    if (/hds-nine\.vercel\.app$/.test(x.hostname) && x.pathname.includes('pay')) return 'Payment link';
    if (x.pathname.includes('/hdsquotes/')) return 'Quote PDF';
    const s = x.hostname + x.pathname;
    return s.length > 42 ? s.slice(0, 40) + '…' : s;
  } catch { return u; }
}

export const rand = (n: number | null | undefined) =>
  n == null ? '' : 'R' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

export const time = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

export function dayLabel(iso: string) {
  const d = new Date(iso), now = new Date();
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString('en-ZA', { weekday: 'long' });
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/** Human label for a quoted/replied-to message preview bar. */
export function msgPreview(m: { type: string; body?: string | null; payload?: Record<string, any> }): string {
  if (m.payload?.quote?.short_number) return `Quote ${m.payload.quote.short_number}`;
  const body = (m.body || '').replace(/\s+/g, ' ').trim();
  if (body) return body.slice(0, 80);
  return { image: 'Photo', video: 'Video', audio: 'Voice note', document: m.payload?.filename || 'Document', location: 'Location', carousel: 'Products' }[m.type] || 'Message';
}
