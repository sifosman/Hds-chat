// Send an HDS Chat sign-in link over WhatsApp (no OTP — the link IS the sign-in).
// The customer must have messaged us on WhatsApp within the last 23h (free-form window).
// Usage: node scripts/send-invite.mjs <phone> [base-url]   e.g. node scripts/send-invite.mjs 0658475289
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => /^[A-Z_]+=/i.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));

const phone = process.argv[2];
const base = process.argv[3] || 'https://chat.hdsgroup.co.za';
if (!phone) { console.error('Usage: node scripts/send-invite.mjs <phone> [base-url]'); process.exit(1); }

const r = await fetch(base + '/api/internal/invite/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-internal-key': env.INTERNAL_KEY },
  body: JSON.stringify({ phone }),
});
const j = await r.json().catch(() => ({}));
if (!r.ok) { console.error('FAILED', r.status, j.error || '', j.message || ''); process.exit(1); }
console.log('WhatsApp invite sent:', j.url);
