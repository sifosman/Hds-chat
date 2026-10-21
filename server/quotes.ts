import { db } from './db.js';

export const phoneVariants = (p: string) => [p, '+' + p, p.startsWith('27') ? '0' + p.slice(2) : p];
const orPhones = (col: string, p: string) => phoneVariants(p).map(v => `${col}.eq.${v}`).join(',');

const QUOTE_COLS = 'id, quote_number, filename, created_at, expires_at, status, total, subtotal, tax, project_name, branch_trading_as, payment_method, cutlist_url, quote_data';
const PDF_BASE = 'https://xzsibbbghotreolzwnyk.supabase.co/storage/v1/object/public/hdsquotes/';

export function summarizeQuote(q: any, invoices: any[] = []) {
  const qd = q.quote_data || {};
  const lines: { label: string; amount: number | null }[] = [];
  for (const s of qd.sections || []) {
    if (s.boardsNeeded) lines.push({ label: `${s.boardsNeeded} × ${s.material}${s.pricePerBoard ? ` @ R${Number(s.pricePerBoard).toLocaleString('en-ZA')}` : ''}`, amount: Number(s.boardsNeeded) * Number(s.pricePerBoard || 0) || null });
    if (s.cuttingFee) lines.push({ label: `Cutting — ${s.material}`, amount: Number(s.cuttingFee) });
    if (s.edging?.cost) lines.push({ label: `Edging — ${s.material}${s.edging.billedMeters ? ` (${s.edging.billedMeters}m)` : ''}`, amount: Number(s.edging.cost) });
  }
  for (const h of qd.hardwareItems || []) lines.push({ label: `${h.quantity} × ${h.name}`, amount: Number(h.lineTotal ?? (h.unitPrice * h.quantity)) || null });
  if (!lines.length) for (const it of qd.items || []) lines.push({ label: it.description, amount: Number(it.total) || null });
  const inv = invoices.filter(i => i.quote_number === q.quote_number && i.status !== 'cancelled');
  const paid = inv.find(i => i.status === 'paid');
  const pending = inv.find(i => i.status === 'pending');
  const expired = q.expires_at && new Date(q.expires_at) < new Date();
  return {
    quote_number: q.quote_number,
    short_number: (q.quote_number.match(/^Q-\d{8}-\d{4}/) || [q.quote_number])[0],
    created_at: q.created_at, expires_at: q.expires_at,
    total: Number(q.total), vat: Number(q.tax) || null,
    branch: q.branch_trading_as || null,
    project: q.project_name || null,
    status: q.status === 'superseded' ? 'superseded' : paid ? 'paid' : expired ? 'expired' : 'open',
    pdf_url: PDF_BASE + encodeURIComponent(q.filename || q.quote_number),
    cutlist_url: q.cutlist_url || null,
    invoice: paid || pending ? { number: (paid || pending).invoice_number, status: (paid || pending).status, pdf_url: (paid || pending).pdf_url || null, total: Number((paid || pending).total) } : null,
    lines: lines.slice(0, 30),
  };
}

export async function listQuotes(phone: string) {
  const { data: quotes } = await db().from('quotes').select(QUOTE_COLS).or(orPhones('customer_phone', phone))
    .order('created_at', { ascending: false }).limit(60);
  const nums = (quotes || []).map(q => q.quote_number);
  const { data: invoices } = nums.length
    ? await db().from('invoices').select('invoice_number, quote_number, status, total, pdf_url, created_at').in('quote_number', nums)
    : { data: [] as any[] };
  return (quotes || []).map(q => summarizeQuote(q, invoices || []));
}

/** Resolve a quote reference (full or short number) that belongs to this phone. */
export async function getQuote(phone: string, ref: string) {
  const r = ref.replace(/[^A-Za-z0-9&\-]/g, '');
  if (!/^Q-20\d{6}-\d{4}/.test(r)) return null;
  const { data } = await db().from('quotes').select(QUOTE_COLS + ', customer_phone').in('customer_phone', phoneVariants(phone))
    .or(`quote_number.ilike.${r},quote_number.ilike.${r}-%`).order('created_at', { ascending: false }).limit(5);
  const mine = (data || []).find((q: any) => phoneVariants(phone).includes(String(q.customer_phone || '')));
  if (!mine) return null;
  const { data: invoices } = await db().from('invoices').select('invoice_number, quote_number, status, total, pdf_url').eq('quote_number', (mine as any).quote_number);
  return summarizeQuote(mine, invoices || []);
}
