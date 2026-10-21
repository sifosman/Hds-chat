import type { AppUser } from './auth.js';
import { db } from './db.js';
import { HttpError } from './http.js';
import { deliverOutbound } from './messages.js';

/** App-only watchdog: never replay the original workflow or mutate business/payment tables. */
export const TURN_LIMITS = Object.freeze({ batch: 10, budgetMs: 18_000, queryMs: 4_000, deliveryMs: 5_000, timeoutMs: 10 * 60_000 });
export const TURN_INTERRUPTION_NOTICE = 'The reply to your request was interrupted or delayed. Your message is saved. Please check Quotes before requesting a duplicate.';
const USER_COLS = 'id,phone,name,realtime_topic,status,created_at,wa_history_cutoff';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type TerminalState = 'completed' | 'failed' | 'timed_out';
export interface TurnResult {
  matched: boolean;
  changed: boolean;
  message_id?: string;
  phone?: string;
  state?: TerminalState;
  notice_pending?: boolean;
}
interface PendingTurn { message_id: string; phone: string; state: 'failed' | 'timed_out'; notice_pending: true; changed?: boolean }
interface Run { signal: AbortSignal; deadline: number }

// Promise race also bounds a dependency that does not honor cancellation. Durable work is
// acknowledged separately, so an interrupted/in-flight insert will be retried idempotently.
async function bounded<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    })]);
  } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
}
async function withRun<T>(work: (run: Run) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('turn_budget_ended')), TURN_LIMITS.budgetMs);
  try { return await work({ signal: controller.signal, deadline: Date.now() + TURN_LIMITS.budgetMs }); }
  finally { clearTimeout(timer); }
}
async function checked(query: any, run: Run): Promise<any> {
  run.signal.throwIfAborted();
  const signal = AbortSignal.any([run.signal, AbortSignal.timeout(TURN_LIMITS.queryMs)]);
  const { data, error } = await bounded<{ data: any; error: unknown }>(query.abortSignal(signal), signal);
  if (error) throw new HttpError(503, 'turn_storage_unavailable');
  return data;
}
function pendingTurn(row: any): row is PendingTurn {
  return row && UUID.test(row.message_id) && typeof row.phone === 'string' && /^\d{8,15}$/.test(row.phone) &&
    (row.state === 'failed' || row.state === 'timed_out') && row.notice_pending === true;
}

/** Clear the flag ONLY after deliverOutbound resolves; retries reuse this exact message identity. */
async function deliverNotice(turn: PendingTurn, run: Run): Promise<boolean> {
  const users: AppUser[] = await checked(db().from('app_users').select(USER_COLS)
    .eq('phone', turn.phone).eq('status', 'active').limit(1), run) || [];
  const user = users[0];
  if (!user || user.status !== 'active' || user.phone !== turn.phone) return false;
  const signal = AbortSignal.any([run.signal, AbortSignal.timeout(TURN_LIMITS.deliveryMs)]);
  signal.throwIfAborted();
  await bounded(deliverOutbound(user, {
    type: 'system', body: TURN_INTERRUPTION_NOTICE,
    payload: { source: 'turn_recovery', message_id: turn.message_id },
  }, {
    sender: 'system', idempotency: `turn-interrupted:${turn.message_id}`,
    // The transition RPC already cleared typing atomically if no other turn was running.
    // Never let an old failure notice stop the typing of a newly claimed turn.
    preserveTyping: true, signal,
  }), signal);
  await checked(db().rpc('app_ack_turn_notice', { p_message_id: turn.message_id }), run);
  return true;
}

/** Internal-authenticated caller only. Unknown/legacy executions are harmless unmatched callbacks.
 * Terminal states are absorbing: late failure cannot downgrade completed, and late completion
 * cannot contradict a timeout notice. This records delivery state, not business side-effect outcome.
 * Notice errors do not undo a durable finish; recoverStalledTurns retries them later.
 */
export async function finishTurn(execution: string, outcome: 'completed' | 'failed'): Promise<TurnResult> {
  if (typeof execution !== 'string' || !execution.trim() || execution.length > 200 || !['completed', 'failed'].includes(outcome)) {
    throw new HttpError(400, 'invalid_turn_finish');
  }
  return withRun(async run => {
    let result: TurnResult;
    try {
      result = await checked(db().rpc('app_finish_turn', { p_execution: execution, p_outcome: outcome }), run);
      if (!result || typeof result.matched !== 'boolean' || typeof result.changed !== 'boolean') throw new Error('invalid_result');
    } catch { throw new HttpError(503, 'turn_storage_unavailable'); }
    if (result.matched && pendingTurn(result)) {
      try { if (await deliverNotice(result, run)) result = { ...result, notice_pending: false }; }
      catch { /* Keep the durable pending flag for the watchdog, not workflow retries. */ }
    }
    return result;
  });
}

/** Small resumable app-only batch. No n8n, WhatsApp, handover, financial tools, or business writes. */
export async function recoverStalledTurns() {
  return withRun(async run => {
    const result = { ok: true, examined: 0, timed_out: 0, delivered: 0, failures: 0, budget_reached: false };
    try {
      const rows: unknown = await checked(db().rpc('app_recover_turns'), run);
      if (!Array.isArray(rows)) throw new Error('invalid_result');
      const batch = rows.slice(0, TURN_LIMITS.batch);
      // The RPC committed every timeout in this batch even if the delivery budget ends early.
      result.timed_out = batch.filter(row => pendingTurn(row) && row.changed && row.state === 'timed_out').length;
      for (const row of batch) {
        if (run.signal.aborted || run.deadline - Date.now() < 1_000) { result.budget_reached = true; break; }
        result.examined++;
        if (!pendingTurn(row)) { result.failures++; continue; }
        try { if (await deliverNotice(row, run)) result.delivered++; }
        catch { result.failures++; }
      }
    } catch { result.failures++; }
    result.budget_reached ||= run.signal.aborted || Date.now() >= run.deadline;
    result.ok = result.failures === 0;
    return result;
  });
}
