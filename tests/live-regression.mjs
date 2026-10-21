// Broader William regression: hardware add-on, quote revision, payment-claim gate,
// multilingual request and nonsense/error handling — each on BOTH the app channel and the
// existing WhatsApp TEST clone (never the live WA webhook). Reserved synthetic phones only.
// Usage: node tests/live-regression.mjs [baseApp] (reads .env.local)
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildTextPayload } from '../../Chatbot Tests/harness/payload.js';
import { whiteUnitPrice } from './live-pricing.mjs';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const BASE = (process.argv[2] || 'https://hds-chat.vercel.app').replace(/\/$/, '');
const SBH = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const sb = async (p) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${p}`, { headers: SBH }); if (!r.ok) throw Error('Supabase ' + r.status + ' ' + (await r.text()).slice(0, 200)); return r.json(); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const iso = (d) => new Date(d).toISOString();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail: String(detail).slice(0, 400) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) throw Error('scenario failed: ' + name); };

// ---------- channel helpers ----------
async function appLogin(phone) {
  const r = await fetch(`${BASE}/api/internal/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': env.INTERNAL_KEY }, body: JSON.stringify({ phone, channel: 'regression-test' }) });
  const inv = await r.json(); if (!r.ok) throw Error('invite ' + r.status);
  const red = await fetch(`${BASE}/api/auth/invite/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: inv.url.split('/i/')[1], platform: 'test' }) });
  const auth = await red.json(); if (!red.ok) throw Error('redeem ' + red.status);
  return auth.token;
}
async function appSend(token, phone, text, sinceMs) {
  const client_id = randomUUID().replaceAll('-', '');
  await fetch(`${BASE}/api/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ client_id, type: 'text', body: text }) });
  const t0 = Date.now();
  for (let n = 0; n < 60; n++) {
    await sleep(5000);
    const msgs = (await (await fetch(`${BASE}/api/messages?limit=200&after=${iso(sinceMs)}`, { headers: { Authorization: 'Bearer ' + token } })).json()).messages;
    if (msgs.some(m => m.direction === 'out')) return { msgs, elapsed: Math.round((Date.now() - t0) / 1000) };
  }
  throw Error(`app reply timeout (${phone}): ${text.slice(0, 60)}`);
}
async function cloneSend(phone, text, sinceMs) {
  const payload = buildTextPayload({ phoneNumber: phone, senderName: 'TEST ONLY Regression', messageText: text, wabaId: 'hds-test', displayPhoneNumber: '27787060895', phoneNumberId: '732486796615007' });
  const r = await fetch('https://n8n.owdsolutions.co.za/webhook/hds-whatsapp-test-media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) throw Error('clone webhook ' + r.status);
  const t0 = Date.now();
  for (let n = 0; n < 60; n++) {
    await sleep(5000);
    const rows = await sb(`ai_conversations?phone_number=eq.${phone}&role=eq.assistant&created_at=gte.${iso(sinceMs)}&select=id,created_at`);
    if (rows.length) return { rows, elapsed: Math.round((Date.now() - t0) / 1000) };
  }
  throw Error(`clone reply timeout (${phone}): ${text.slice(0, 60)}`);
}
const freshQuotes = (phone, sinceMs) => sb(`quotes?customer_phone=eq.${phone}&or=(created_at.gte.${iso(sinceMs)},updated_at.gte.${iso(sinceMs)})&select=quote_number,total,branch_trading_as,status,quote_data,created_at,updated_at&order=updated_at.desc`);
const branchChecks = (phone) => sb(`branch_payment_checks?customer_phone=eq.${phone}&select=id`);
const hasHinge = (q) => JSON.stringify(q.quote_data?.hardwareItems || []).match(/hinge/i) || JSON.stringify(q.quote_data?.items || []).match(/hinge/i);

async function runPair(label, fn) {
  const t0 = Date.now();
  try { await fn(); check(label, true, Math.round((Date.now() - t0) / 1000) + 's'); }
  catch (e) { results.push({ name: label, ok: false, detail: String(e.message).slice(0, 400) }); console.log(`FAIL  ${label} — ${e.message}`); }
}

// ---------- scenarios ----------
try {
  // --- S1: hardware add-on after a boards-only quote (HWMERGE path) ---
  await runPair('S1 hardware add-on parity (app+clone)', async () => {
    const A = '27900000845', C = '27900000855';
    const unit = { A: await whiteUnitPrice(env, A), C: await whiteUnitPrice(env, C) };
    const appToken = await appLogin(A);
    const t0 = Date.now();
    const base = 'Hi, my name is Reg Pilot. I need a quote for 2 full sheets of Premium White melamine 16mm. No cutting, no edging, no hardware, no delivery. I will collect at HDS Church Street in Pretoria and pay at the branch. Please generate the quote now.';
    const [a1, c1] = await Promise.all([appSend(appToken, A, base, t0), cloneSend(C, base, t0)]);
    await sleep(8000); // let the engine settle on both channels
    const ask = 'Please add 4 Titan soft-close full-overlay hinges (the standard ones) to my quote for the cabinet doors. Generate it now.';
    const t1 = Date.now();
    const [a2, c2] = await Promise.all([appSend(appToken, A, ask, t1), cloneSend(C, ask, t1)]);
    await sleep(8000);
    const [qa, qc] = await Promise.all([freshQuotes(A, t0), freshQuotes(C, t0)]);
    const ha = qa.filter(hasHinge), hc = qc.filter(hasHinge);
    check('S1 hinge line present in app quote', ha.length > 0, qa.map(q => q.quote_number).join(','));
    check('S1 hinge line present in clone quote', hc.length > 0, qc.map(q => q.quote_number).join(','));
    check('S1 hardware totals equal across channels', ha[0]?.total === hc[0]?.total, `app ${ha[0]?.total} vs clone ${hc[0]?.total}`);
    const hwSum = q => (q.quote_data?.hardwareItems || []).reduce((n, h) => n + Number(h.lineTotal ?? 0), 0);
    check('S1 hinge quote = boards + hinges on both channels', ha[0]?.total === 2 * unit.A + hwSum(ha[0]) && hc[0]?.total === 2 * unit.C + hwSum(hc[0]), `app ${ha[0]?.total}=${2 * unit.A}+${hwSum(ha[0])} | clone ${hc[0]?.total}=${2 * unit.C}+${hwSum(hc[0])}`);
  });

  // --- S2: quote revision + payment non-claim gate ---
  await runPair('S2 revision parity + payment non-claim gate', async () => {
    const A = '27900000846', C = '27900000856';
    const unit = { A: await whiteUnitPrice(env, A), C: await whiteUnitPrice(env, C) };
    const appToken = await appLogin(A);
    const checksBefore = { A: (await branchChecks(A)).length, C: (await branchChecks(C)).length };
    const t0 = Date.now();
    const base = 'Hi, my name is Rev Pilot. I need a quote for 4 full sheets of Premium White melamine 16mm. No cutting, no edging, no hardware, no delivery. I will collect at HDS Church Street in Pretoria and pay at the branch. Please generate the quote now.';
    await Promise.all([appSend(appToken, A, base, t0), cloneSend(C, base, t0)]);
    await sleep(8000);
    const t1 = Date.now();
    const rev = 'Please change my quote to 6 full sheets of Premium White 16mm instead of 4 — same everything else. Generate the updated quote now.';
    const [ar, cr] = await Promise.all([appSend(appToken, A, rev, t1), cloneSend(C, rev, t1)]);
    await sleep(8000);
    const [qa, qc] = await Promise.all([freshQuotes(A, t0), freshQuotes(C, t0)]);
    const na = qa[0], nc = qc[0];
    check('S2 app revision total = 6 sheets', na?.total === 6 * unit.A, `${na?.total} vs ${6 * unit.A}`);
    check('S2 clone revision total = 6 sheets', nc?.total === 6 * unit.C, `${nc?.total} vs ${6 * unit.C}`);
    const t2 = Date.now();
    const q = 'How long will my quote take to be ready?';
    const [apay, cpay] = await Promise.all([appSend(appToken, A, q, t2), cloneSend(C, q, t2)]);
    const checksAfter = { A: (await branchChecks(A)).length, C: (await branchChecks(C)).length };
    check('S2 no branch payment check without a payment claim (app)', checksAfter.A === checksBefore.A, `${checksBefore.A} -> ${checksAfter.A}`);
    check('S2 no branch payment check without a payment claim (clone)', checksAfter.C === checksBefore.C, `${checksBefore.C} -> ${checksAfter.C}`);
    check('S2 turnaround question still answered (app)', apay.msgs.length > 0);
    check('S2 turnaround question still answered (clone)', cpay.rows.length > 0);
  });

  // --- S3: multilingual (Afrikaans) request ---
  await runPair('S3 Afrikaans request parity', async () => {
    const A = '27900000847', C = '27900000857';
    const unit = { A: await whiteUnitPrice(env, A), C: await whiteUnitPrice(env, C) };
    const appToken = await appLogin(A);
    const t0 = Date.now();
    const text = 'Goeie more! Ek is Sannie. Ek wil graag \'n kwotasie hê vir 2 volle velle Premium White melamine 16mm. Geen sny of rande nie, geen aflewering nie. Ek sal dit by HDS Church Street in Pretoria gaan optel en by die tak betaal. Genereer die kwotasie asseblief nou.';
    await Promise.all([appSend(appToken, A, text, t0), cloneSend(C, text, t0)]);
    await sleep(8000);
    const [qa, qc] = await Promise.all([freshQuotes(A, t0), freshQuotes(C, t0)]);
    check('S3 app Afrikaans quote total = 2 sheets', qa.some(x => x.total === 2 * unit.A), qa.map(x => x.total).join(','));
    check('S3 clone Afrikaans quote total = 2 sheets', qc.some(x => x.total === 2 * unit.C), qc.map(x => x.total).join(','));
  });

  // --- S4: nonsense input handled gracefully ---
  await runPair('S4 nonsense input handled (no quote)', async () => {
    const A = '27900000848', C = '27900000858';
    const appToken = await appLogin(A);
    const t0 = Date.now();
    const text = 'asdf qwerty zxcv 12345 ???';
    const [an, cn] = await Promise.all([appSend(appToken, A, text, t0), cloneSend(C, text, t0)]);
    await sleep(5000);
    const [qa, qc] = await Promise.all([freshQuotes(A, t0), freshQuotes(C, t0)]);
    check('S4 no quote from gibberish (app)', qa.length === 0, qa.map(x => x.total).join(','));
    check('S4 no quote from gibberish (clone)', qc.length === 0, qc.map(x => x.total).join(','));
    check('S4 William still replies to gibberish (app)', an.msgs.length > 0, an.msgs[0]?.body?.slice(0, 80));
    check('S4 William still replies to gibberish (clone)', cn.rows.length > 0);
  });

  const failed = results.filter(r => !r.ok);
  writeFileSync('scratch/live-regression-result.json', JSON.stringify({ at: new Date().toISOString(), base: BASE, results, passed: results.length - failed.length, failed: failed.length }, null, 2));
  console.log(`\n==== REGRESSION SUITE: ${results.length - failed.length}/${results.length} checks passed ====`);
  if (failed.length) process.exitCode = 1;
} catch (e) {
  console.error('SUITE ERROR', e.message);
  writeFileSync('scratch/live-regression-result.json', JSON.stringify({ at: new Date().toISOString(), error: e.message, results }, null, 2));
  process.exitCode = 1;
}
