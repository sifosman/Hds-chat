// One-off: create the hds_app_invite WhatsApp template (image header + name/link vars)
// and send it to specific numbers — works outside the 24h window (that's what templates are for).
// Usage: node scripts/send-invite-template.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => /^[A-Z_]+=/i.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));

const TOK = env.WA_TOKEN, PHONE_ID = env.WA_PHONE_ID, WABA = '651569391231371', APP_ID = '1491765108452052';
const CARD = 'https://hds-chat.vercel.app/invite-card.jpg';
const G = (p, opts = {}) => fetch(`https://graph.facebook.com/v20.0${p}`, { ...opts, headers: { Authorization: 'Bearer ' + TOK, ...(opts.headers || {}) } });

// Recipients: phone -> { name, inviteUrl }   (links minted earlier via /internal/invite; vercel.app host — custom domain DNS not stable yet)
const RECIPIENTS = [
  { phone: '27719974574', name: 'David', url: 'https://hds-chat.vercel.app/i/CYsyYaWABG4vrTUpIf_BWupxnVVEU7Ukm3zIyEAILm8' },
  { phone: '27832560421', name: '', url: 'https://hds-chat.vercel.app/i/QI2VLiD-gv2aykH_iwpHWtbgGT9jqaElNHaPn_10Bfw' },
];

// ---- 1. Resumable upload of the card so we have a header_handle for template review ----
const img = await fetch(CARD).then(r => r.arrayBuffer());
const up = await G(`/${APP_ID}/uploads?file_name=invite-card.jpg&file_length=${img.byteLength}&file_type=image/jpeg`, { method: 'POST' }).then(r => r.json());
if (!up.id) { console.error('upload init failed', up); process.exit(1); }
const handle = await fetch(`https://graph.facebook.com/v20.0/${up.id}`, {
  method: 'POST', headers: { Authorization: 'OAuth ' + TOK, file_offset: '0', 'Content-Type': 'application/octet-stream' }, body: Buffer.from(img),
}).then(r => r.json());
if (!handle.h) { console.error('upload failed', handle); process.exit(1); }
console.log('media handle:', handle.h.slice(0, 24) + '…');

// ---- 2. Create the template ----
const body = `Hi {{1}}! The new HDS app is here — quotes, cutting lists and app-only specials in one place.\n\nTap your personal link to open it:\n{{2}}\n\nThen "Add to home screen". The link works once and expires in 3 days.`;
const create = await G(`/${WABA}/message_templates`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'hds_app_invite', category: 'MARKETING', language: 'en_US',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle.h] } },
      { type: 'BODY', text: body, example: { body_text: [[RECIPIENTS[0].name || 'there', RECIPIENTS[0].url]] } },
      { type: 'FOOTER', text: 'Reply STOP to opt out.' },
    ],
  }),
}).then(r => r.json());
console.log('create:', JSON.stringify(create));
if (!create.id) process.exit(1);

// ---- 3. Poll until APPROVED (simple templates usually clear in seconds–minutes) ----
let status = 'PENDING';
for (let i = 0; i < 24 && status === 'PENDING'; i++) {
  await new Promise(r => setTimeout(r, 10_000));
  const t = await G(`/${WABA}/message_templates?fields=name,status&name=hds_app_invite`).then(r => r.json());
  status = t.data?.[0]?.status || 'PENDING';
  console.log(`status: ${status}`);
}
if (status !== 'APPROVED') { console.log(`Template is ${status} — rerun the send once approved.`); process.exit(0); }

// ---- 4. Send to the two recipients ----
for (const r of RECIPIENTS) {
  const res = await G(`/${PHONE_ID}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: r.phone, type: 'template',
      template: {
        name: 'hds_app_invite', language: { code: 'en_US' },
        components: [
          { type: 'header', parameters: [{ type: 'image', image: { link: CARD } }] },
          { type: 'body', parameters: [{ type: 'text', text: r.name || 'there' }, { type: 'text', text: r.url }] },
        ],
      },
    }),
  }).then(r => r.json());
  console.log(r.phone, res.messages ? 'SENT ' + res.messages[0].id : 'FAILED ' + JSON.stringify(res.error || res));
}
