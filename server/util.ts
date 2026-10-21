import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const randomCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const waId = () => 'wamid.APP' + randomBytes(16).toString('hex').toUpperCase();

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Normalise a phone number to the digits-only E.164 form the bot uses ("27821234567").
 * South African local numbers ("082 123 4567") get the 27 prefix. Returns null if invalid.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  let s = String(input).trim();
  const hadPlus = s.startsWith('+') || s.startsWith('00');
  let d = s.replace(/\D/g, '');
  if (s.startsWith('00')) d = d.slice(2);
  if (!hadPlus) {
    if (/^0[1-9]\d{8}$/.test(d)) d = '27' + d.slice(1);       // 0821234567
    else if (/^[6-8]\d{8}$/.test(d)) d = '27' + d;             // 821234567
  }
  if (d.startsWith('270') && d.length === 12) d = '27' + d.slice(3); // +27 082…
  if (d.startsWith('27')) return /^27[1-9]\d{8}$/.test(d) ? d : null;
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}

export const maskPhone = (p: string) => (p ? p.slice(0, 4) + '•••' + p.slice(-3) : '');
export const maskName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '');

/** Log without phone numbers / message bodies. */
export function log(event: string, data: Record<string, unknown> = {}) {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (/phone|to|from/i.test(k) && typeof v === 'string') clean[k] = maskPhone(v);
    else if (/body|text|code|token/i.test(k)) clean[k] = typeof v === 'string' ? `[${v.length} chars]` : '[redacted]';
    else clean[k] = v;
  }
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...clean }));
}

export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let to: NodeJS.Timeout;
  const t = new Promise<T>(r => { to = setTimeout(() => r(fallback), ms); });
  try { return await Promise.race([p, t]); } finally { clearTimeout(to!); }
}
