import { Fragment, ReactNode } from 'react';
import { openExternal } from './api';

const URL_RE = /(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,!?;:*_~])/g;

function inline(text: string, key: string): ReactNode[] {
  // WhatsApp markup: *bold* _italic_ ~strike~ ```mono```
  const out: ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const inner = t.startsWith('```') ? t.slice(3, -3) : t.slice(1, -1);
    const k = key + '-' + i++;
    if (t[0] === '*') out.push(<strong key={k}>{inner}</strong>);
    else if (t[0] === '_') out.push(<em key={k}>{inner}</em>);
    else if (t[0] === '~') out.push(<s key={k}>{inner}</s>);
    else out.push(<code key={k}>{inner}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} onClick={e => { e.preventDefault(); openExternal(p); }} rel="noopener noreferrer">{shortUrl(p)}</a>
        ) : (
          <Fragment key={i}>{inline(p, String(i))}</Fragment>
        ),
      )}
    </>
  );
}

function shortUrl(u: string) {
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
