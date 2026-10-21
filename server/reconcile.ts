import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import type { AppUser } from './auth.js';
import { deliverOutbound } from './messages.js';
import { phoneVariants } from './quotes.js';
import type { OutMsg } from './translate.js';
import { log, normalizePhone } from './util.js';

/** Pilot limits: each invocation continues durable cursors; never scan an unbounded table. */
export const ASYNC_LIMITS = Object.freeze({ users: 5, sourceRows: 50, overlapRows: 20, sourceRetries: 20,
  quotes: 20, invoices: 50, deliveries: 20, budgetMs: 40_000, overlapMs: 5 * 60_000 });
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SOURCE_COLS = 'id,phone_number,role,message_text,sender_name,created_at,tool_results,conversation_metadata';
const USER_COLS = 'id,phone,name,realtime_topic,status,created_at,wa_history_cutoff';
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

export interface SourceRow {
  id: string; phone_number: string; role: string; message_text: string | null;
  sender_name?: string | null; created_at: string; tool_results?: unknown; conversation_metadata?: unknown;
}
export interface SourceDelivery { msg: OutMsg; sender: 'bot' | 'agent' | 'system'; senderName?: string; idempotency: string }

/** Pure eligibility mapper: never import generic/pre-send William logs or internal tool rows. */
export function mapAsyncSource(row: SourceRow, user: AppUser, sourceFloor: string): SourceDelivery | null {
  const created = Date.parse(row.created_at), cutoff = Date.parse(user.wa_history_cutoff), floor = Date.parse(sourceFloor);
  if (user.status !== 'active' || !UUID.test(row.id) || !normalizePhone(user.phone) ||
      normalizePhone(row.phone_number) !== user.phone || row.role !== 'assistant' ||
      ![created, cutoff, floor].every(Number.isFinite) || created <= cutoff || created < floor) return null;
  const tool = object(row.tool_results), meta = object(row.conversation_metadata);
  if (tool.channel === 'app' || meta.channel === 'app' || tool.automatic_internal || meta.automatic_internal ||
      tool.private === true || meta.private === true) return null;
  const source = tool.branch_paycheck === true ? 'branch_paycheck' :
    meta.source === 'ai_resolver' || tool.source === 'ai_resolver' ? 'ai_resolver' :
    tool.source === 'chatwoot_reply_bridge' ? 'chatwoot_reply_bridge' : null;
  if (!source) return null;
  const body = typeof row.message_text === 'string' ? row.message_text.trim() : '';
  if (!body || body.length > 12_000 || /^\[attachments sent\]/i.test(body)) return null;
  // Mapping rows/files are not messages. A failed legacy send's log is not proof of an actual reply.
  // Only mirror accepted text; filenames alone cannot reconstruct safe media URLs.
  if (source === 'chatwoot_reply_bridge' && (!Array.isArray(tool.sent) ||
      !tool.sent.some((item: any) => item?.type === 'text' && typeof item.messageId === 'string' && item.messageId.length > 0))) return null;
  return {
    msg: { type: 'text', body, payload: { source: 'async_bridge', original_source: source, source_id: row.id } },
    sender: source === 'chatwoot_reply_bridge' ? 'agent' : source === 'branch_paycheck' ? 'system' : 'bot',
    ...(source === 'chatwoot_reply_bridge' ? { senderName: String(row.sender_name || 'HDS team').slice(0, 100) } : {}),
    idempotency: `async-source:${user.id}:${row.id}`,
  };
}

export interface InvoiceRow { id: string; invoice_number: string; quote_number: string; status: string }
export interface InvoiceObservation { last_status: string; notify_pending: boolean; notified_at: string | null }
/** Initial observations are always silent, even for paid rows. Pending flags survive delivery failure. */
export function nextInvoiceObservation(previous: InvoiceObservation | null, status: string): InvoiceObservation {
  const next = String(status || '').toLowerCase();
  if (!previous) return { last_status: next, notify_pending: false, notified_at: null };
  const becamePaid = ['pending', 'overdue'].includes(previous.last_status) && next === 'paid';
  return { last_status: next, notify_pending: previous.notify_pending || (!previous.notified_at && becamePaid), notified_at: previous.notified_at };
}
export function paidInvoiceMessage(invoice: InvoiceRow, observation: InvoiceObservation, userId: string): SourceDelivery | null {
  if (!UUID.test(invoice.id) || String(invoice.status || '').toLowerCase() !== 'paid' || !observation.notify_pending || observation.notified_at ||
      !invoice.invoice_number || !/^Q-\d{8}-\d{4}(?:-[A-Za-z0-9&]+)*$/.test(invoice.quote_number)) return null;
  return {
    msg: { type: 'system', body: `Payment for invoice ${invoice.invoice_number} (quote ${invoice.quote_number}) is now marked paid.`,
      payload: { source: 'async_invoice_observation', invoice_id: invoice.id, invoice_number: invoice.invoice_number, quote_ref: invoice.quote_number } },
    sender: 'system', idempotency: `invoice-paid:${userId}:${invoice.id}`,
  };
}

interface UserState { user_id: string; source_floor: string; source_cursor_at: string; source_cursor_id: string | null; quote_cursor: string | null; invoice_cursor: string | null }
interface Run { deadline: number; deliveries: number; delivered: number; queued: number; baselines: number; users: number; failures: number; lease: string }
class BudgetEnded extends Error {}
async function checked(query: any, run: Run): Promise<any> {
  const left = run.deadline - Date.now();
  if (left < 1000) throw new BudgetEnded();
  const { data, error } = await query.abortSignal(AbortSignal.timeout(Math.min(left, 8000)));
  if (error) throw new Error('async_bridge_storage_failed');
  return data;
}
async function activeUser(user: AppUser, run: Run): Promise<boolean> {
  const current = await checked(db().from('app_users').select('status,phone').eq('id', user.id).maybeSingle(), run);
  return current?.status === 'active' && current.phone === user.phone;
}
async function deliver(user: AppUser, item: SourceDelivery, run: Run): Promise<boolean> {
  if (run.deliveries >= ASYNC_LIMITS.deliveries || run.deadline - Date.now() < 5000) throw new BudgetEnded();
  if (!await activeUser(user, run)) return false;
  run.deliveries++;
  // No provider or workflow calls here: this only creates app_* messages, realtime and app push.
  await deliverOutbound(user, item.msg, { sender: item.sender, senderName: item.senderName, idempotency: item.idempotency });
  run.delivered++;
  return true;
}
async function saveState(userId: string, patch: Record<string, unknown>, run: Run) {
  await checked(db().from('app_async_user_state').update(patch).eq('user_id', userId), run);
}
async function getState(user: AppUser, run: Run): Promise<UserState> {
  let state = await checked(db().from('app_async_user_state').select('*').eq('user_id', user.id).maybeSingle(), run);
  if (!state) {
    // DEFAULT BOOTSTRAP: do not flood customers with pre-existing asynchronous logs.
    // Post-cutoff rows are eligible only from the first bridge observation onward.
    const floor = new Date(Math.max(Date.now(), Date.parse(user.wa_history_cutoff))).toISOString();
    state = await checked(db().from('app_async_user_state').insert({ user_id: user.id, source_floor: floor, source_cursor_at: floor }).select('*').single(), run);
    run.baselines++;
  }
  return state as UserState;
}
async function enqueueSources(user: AppUser, state: UserState, run: Run) {
  let forward = db().from('ai_conversations').select(SOURCE_COLS).in('phone_number', phoneVariants(user.phone))
    .eq('role', 'assistant').gte('created_at', state.source_floor).order('created_at').order('id').limit(ASYNC_LIMITS.sourceRows);
  forward = state.source_cursor_id
    ? forward.or(`created_at.gt.${state.source_cursor_at},and(created_at.eq.${state.source_cursor_at},id.gt.${state.source_cursor_id})`)
    : forward.gte('created_at', state.source_cursor_at);
  const rows: SourceRow[] = await checked(forward, run) || [];
  // A bounded overlap catches recent rows whose contents/source markers were finalized after insert.
  const overlapFloor = new Date(Math.max(Date.parse(state.source_floor), Date.parse(state.source_cursor_at) - ASYNC_LIMITS.overlapMs)).toISOString();
  const overlap: SourceRow[] = await checked(db().from('ai_conversations').select(SOURCE_COLS).in('phone_number', phoneVariants(user.phone))
    .eq('role', 'assistant').gte('created_at', overlapFloor).lte('created_at', state.source_cursor_at)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(ASYNC_LIMITS.overlapRows), run) || [];
  const eligible = [...new Map([...rows, ...overlap].filter(row => mapAsyncSource(row, user, state.source_floor)).map(row => [row.id, row])).values()];
  if (eligible.length) {
    // ignoreDuplicates is essential: replaying overlap may NEVER reset delivered rows to pending.
    await checked(db().from('app_async_source_queue').upsert(eligible.map(row => ({ user_id: user.id, source_id: row.id })),
      { onConflict: 'user_id,source_id', ignoreDuplicates: true }), run);
    run.queued += eligible.length;
  }
  // All eligible source IDs are durable before advancing. Delivery failures remain queued.
  const last = rows.at(-1);
  if (last) await saveState(user.id, { source_cursor_at: last.created_at, source_cursor_id: last.id }, run);
}
async function drainSources(user: AppUser, state: UserState, run: Run) {
  const pending: { source_id: string }[] = await checked(db().from('app_async_source_queue').select('source_id').eq('user_id', user.id)
    .eq('state', 'pending').order('queued_at').order('source_id').limit(ASYNC_LIMITS.sourceRetries), run) || [];
  if (!pending.length) return;
  const sourceRows: SourceRow[] = await checked(db().from('ai_conversations').select(SOURCE_COLS).in('id', pending.map(p => p.source_id)), run) || [];
  const byId = new Map(sourceRows.map(row => [row.id, row]));
  for (const p of pending) {
    const row = byId.get(p.source_id);
    const item = row ? mapAsyncSource(row, user, state.source_floor) : null;
    if (!item) {
      await checked(db().from('app_async_source_queue').update({ state: 'skipped' }).eq('user_id', user.id).eq('source_id', p.source_id), run);
      continue;
    }
    try {
      if (!await deliver(user, item, run)) return;
      await checked(db().from('app_async_source_queue').update({ state: 'delivered', delivered_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('source_id', p.source_id), run);
    } catch (e) {
      if (e instanceof BudgetEnded) throw e;
      run.failures++;
      // Keep the durable row pending. Log counts only, never a phone, message, URL or DB error.
      log('async_source_delivery_failed');
    }
  }
}
async function observeInvoices(user: AppUser, state: UserState, run: Run) {
  let quotesQuery = db().from('quotes').select('id,quote_number,customer_phone,status').in('customer_phone', phoneVariants(user.phone))
    .order('id').limit(ASYNC_LIMITS.quotes);
  if (state.quote_cursor) quotesQuery = quotesQuery.gt('id', state.quote_cursor);
  const quotes: any[] = await checked(quotesQuery, run) || [];
  if (!quotes.length) { await saveState(user.id, { quote_cursor: null, invoice_cursor: null }, run); return; }
  // Recheck complete canonical phone equality; never last-nine-digit ownership guesses.
  const owned = new Map(quotes.filter(q => normalizePhone(q.customer_phone) === user.phone && !['cancelled', 'superseded'].includes(String(q.status).toLowerCase()))
    .map(q => [q.quote_number, q]));
  if (!owned.size) { await saveState(user.id, { quote_cursor: quotes.at(-1).id, invoice_cursor: null }, run); return; }
  let invoiceQuery = db().from('invoices').select('id,invoice_number,quote_number,status').in('quote_number', [...owned.keys()])
    .order('id').limit(ASYNC_LIMITS.invoices);
  if (state.invoice_cursor) invoiceQuery = invoiceQuery.gt('id', state.invoice_cursor);
  const invoices: InvoiceRow[] = await checked(invoiceQuery, run) || [];
  const observations: any[] = invoices.length ? await checked(db().from('app_invoice_observations').select('*').eq('user_id', user.id)
    .in('invoice_id', invoices.map(invoice => invoice.id)), run) || [] : [];
  const existing = new Map(observations.map(row => [row.invoice_id, row]));
  for (const invoice of invoices) {
    if (!UUID.test(invoice.id) || !owned.has(invoice.quote_number)) continue;
    const previous = existing.get(invoice.id) || null;
    const next = nextInvoiceObservation(previous, invoice.status);
    // Persist notify_pending BEFORE delivery. A crash/retry cannot lose the transition.
    await checked(db().from('app_invoice_observations').upsert({ user_id: user.id, invoice_id: invoice.id,
      ...next, observed_at: new Date().toISOString() }, { onConflict: 'user_id,invoice_id' }), run);
    const item = paidInvoiceMessage(invoice, next, user.id);
    if (!item) {
      // Checkpoint ordinary rows as well, so a large baseline cannot monopolize the time budget.
      await saveState(user.id, { invoice_cursor: invoice.id }, run);
      continue;
    }
    // Invoice/quote status might have changed since the batch read; recheck immediately before notifying.
    const liveInvoice = await checked(db().from('invoices').select('id,invoice_number,quote_number,status').eq('id', invoice.id).maybeSingle(), run);
    const liveQuote = await checked(db().from('quotes').select('customer_phone,status').eq('quote_number', invoice.quote_number).maybeSingle(), run);
    if (liveInvoice?.status !== 'paid' || liveInvoice.quote_number !== invoice.quote_number ||
        normalizePhone(liveQuote?.customer_phone) !== user.phone || ['cancelled', 'superseded'].includes(String(liveQuote?.status).toLowerCase())) continue;
    try {
      if (!await deliver(user, item, run)) return;
      await checked(db().from('app_invoice_observations').update({ notify_pending: false, notified_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('invoice_id', invoice.id).eq('notify_pending', true), run);
    } catch (e) {
      if (e instanceof BudgetEnded) throw e;
      run.failures++;
      log('async_invoice_delivery_failed');
    }
    await saveState(user.id, { invoice_cursor: invoice.id }, run);
  }
  // Repeated scans cover OLD pending invoices as well as new ones: no updated_at cursor exists upstream.
  await saveState(user.id, invoices.length === ASYNC_LIMITS.invoices
    ? { invoice_cursor: invoices.at(-1)!.id }
    : { quote_cursor: quotes.at(-1).id, invoice_cursor: null }, run);
}

/** Call only from a parent-authenticated internal route/scheduler. No live upstream changes.
 * Active app_users are provisioned by the verified OTP/invite auth path; no new verification flag is invented.
 * First source scan starts NOW (or cutoff if later); first invoice observation is silent.
 * Returns counts only. Completion is bounded and resumable, not a full-account scan guarantee.
 */
export async function reconcileAsync() {
  const run: Run = { deadline: Date.now() + ASYNC_LIMITS.budgetMs, deliveries: 0, delivered: 0, queued: 0, baselines: 0, users: 0, failures: 0, lease: randomUUID() };
  const acquired = await checked(db().rpc('app_async_claim_run', { p_token: run.lease }), run);
  if (!acquired) return { ok: true, busy: true, users: 0, delivered: 0 };
  let budgetReached = false;
  try {
    const globalState = await checked(db().from('app_async_bridge_state').select('user_cursor').eq('singleton', true).single(), run);
    let query = db().from('app_users').select(USER_COLS).eq('status', 'active').order('id').limit(ASYNC_LIMITS.users);
    if (globalState.user_cursor) query = query.gt('id', globalState.user_cursor);
    const users: AppUser[] = await checked(query, run) || [];
    if (!users.length) await checked(db().from('app_async_bridge_state').update({ user_cursor: null }).eq('lease_token', run.lease), run);
    for (const user of users) {
      try {
        if (normalizePhone(user.phone) !== user.phone || !Number.isFinite(Date.parse(user.wa_history_cutoff))) {
          run.failures++;
          await checked(db().from('app_async_bridge_state').update({ user_cursor: user.id }).eq('lease_token', run.lease), run);
          continue;
        }
        const state = await getState(user, run);
        await enqueueSources(user, state, run);
        // Observe business rows even if the source queue is busy. Each user gets at most one bounded page per run.
        await observeInvoices(user, state, run);
        await drainSources(user, state, run);
        await saveState(user.id, { last_run_at: new Date().toISOString() }, run);
        run.users++;
      } catch (e) {
        if (e instanceof BudgetEnded) { budgetReached = true; break; }
        run.failures++;
        log('async_user_reconcile_failed');
      }
      await checked(db().from('app_async_bridge_state').update({ user_cursor: user.id }).eq('lease_token', run.lease), run);
    }
  } catch (e) {
    if (e instanceof BudgetEnded) budgetReached = true;
    else { run.failures++; log('async_reconcile_failed'); }
  } finally {
    // Independent short release timeout even when the work budget ended. On crash, lease self-expires.
    try { await db().from('app_async_bridge_state').update({ lease_token: null, lease_until: null }).eq('lease_token', run.lease).abortSignal(AbortSignal.timeout(2000)); } catch { /* expires */ }
  }
  const result = { ok: run.failures === 0, users: run.users, delivered: run.delivered, queued: run.queued,
    baselines: run.baselines, failures: run.failures, budget_reached: budgetReached };
  log('async_reconcile_complete', result);
  return result;
}
