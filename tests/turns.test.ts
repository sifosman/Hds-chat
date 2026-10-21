import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), deliver: vi.fn() }));
vi.mock('../server/db.js', () => ({ db: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('../server/messages.js', () => ({ deliverOutbound: mocks.deliver }));
import { finishTurn, recoverStalledTurns, TURN_INTERRUPTION_NOTICE, TURN_LIMITS } from '../server/turns.js';

const phone = '27821234567';
const user = { id: '11111111-1111-4111-8111-111111111111', phone, status: 'active', name: null, realtime_topic: 'test',
  created_at: '2026-10-21T10:00:00Z', wa_history_cutoff: '2026-10-21T10:00:00Z' };
const mid = '22222222-2222-4222-8222-222222222222';
interface Claim { message_id: string; execution: string; phone: string; state: string; notice_pending: boolean; age: number }
let claims: Claim[], active: boolean, deliveryFails: boolean, ackFails: boolean;
let stored: Set<string>, events: string[], filters: [string, unknown][], signals: AbortSignal[];
let typing: boolean;
let botStatuses: Map<string, string>;
const response = (data: any, error: any = null) => ({ data, error });
function builder(resolve: () => any): any {
  return {
    select() { return this; }, limit() { return this; },
    eq(key: string, value: unknown) { filters.push([key, value]); return this; },
    abortSignal(signal: AbortSignal) { signals.push(signal); return this; },
    then(ok: any, fail: any) { return Promise.resolve().then(resolve).then(ok, fail); },
  };
}
function claim(state = 'running', age = 11 * 60_000): Claim {
  return { message_id: mid, execution: 'execution-1', phone, state, age, notice_pending: state === 'failed' || state === 'timed_out' };
}
// This fake models the RPC contract for orchestration tests. SQL locking/transition guards
// have separate structural tests; these mocks do NOT claim to prove PostgreSQL concurrency.
beforeEach(() => {
  vi.clearAllMocks();
  claims = [claim()]; active = true; deliveryFails = false; ackFails = false;
  typing = true; botStatuses = new Map(); stored = new Set(); events = []; filters = []; signals = [];
  mocks.from.mockImplementation((table: string) => {
    expect(table).toBe('app_users');
    return builder(() => response(active ? [user] : []));
  });
  mocks.rpc.mockImplementation((name: string, args: any) => builder(() => {
    events.push(name);
    if (name === 'app_finish_turn') {
      const turn = claims.find(c => c.execution === args.p_execution && c.state !== 'legacy');
      if (!turn || !active) return response({ matched: false, changed: false });
      const changed = turn.state === 'running';
      if (changed) {
        turn.state = args.p_outcome; turn.notice_pending = turn.state === 'failed';
        botStatuses.set(turn.message_id, turn.state);
        if (!claims.some(c => c.phone === turn.phone && c.state === 'running')) typing = false;
      }
      return response({ matched: true, changed, message_id: turn.message_id, phone: turn.phone, state: turn.state, notice_pending: turn.notice_pending });
    }
    if (name === 'app_recover_turns') {
      if (!active) return response([]);
      return response(claims.filter(c => (c.state === 'running' && c.age >= TURN_LIMITS.timeoutMs) ||
        (['failed', 'timed_out'].includes(c.state) && c.notice_pending)).slice(0, 10).map(c => {
        const changed = c.state === 'running';
        if (changed) { c.state = 'timed_out'; c.notice_pending = true; botStatuses.set(c.message_id, c.state); }
        if (!claims.some(t => t.phone === c.phone && t.state === 'running')) typing = false;
        return { message_id: c.message_id, phone: c.phone, state: c.state, notice_pending: c.notice_pending, changed };
      }));
    }
    if (name === 'app_ack_turn_notice') {
      if (ackFails) return response(null, { message: 'private_database_details' });
      const turn = claims.find(c => c.message_id === args.p_message_id)!;
      turn.notice_pending = false;
      return response(true);
    }
    throw new Error('unexpected RPC');
  }));
  mocks.deliver.mockImplementation(async (_user: any, _message: any, opts: any) => {
    events.push('deliver');
    if (deliveryFails) throw new Error('delivery_failed');
    stored.add(opts.idempotency);
    return { id: 'outbound-1' };
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('durable finish orchestration', () => {
  it('completes once and never sends an interruption for a late failure', async () => {
    expect(await finishTurn('execution-1', 'completed')).toMatchObject({ matched: true, changed: true, state: 'completed', notice_pending: false });
    expect(await finishTurn('execution-1', 'failed')).toMatchObject({ matched: true, changed: false, state: 'completed' });
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(botStatuses.get(mid)).toBe('completed');
    expect(typing).toBe(false);
  });
  it('persists failure before notice and only acknowledges after delivery success', async () => {
    expect(await finishTurn('execution-1', 'failed')).toMatchObject({ changed: true, state: 'failed', notice_pending: false });
    expect(events).toEqual(['app_finish_turn', 'deliver', 'app_ack_turn_notice']);
    expect(botStatuses.get(mid)).toBe('failed');
    expect(mocks.deliver).toHaveBeenCalledWith(user, {
      type: 'system', body: TURN_INTERRUPTION_NOTICE, payload: { source: 'turn_recovery', message_id: mid },
    }, expect.objectContaining({ sender: 'system', preserveTyping: true, idempotency: `turn-interrupted:${mid}`, signal: expect.any(AbortSignal) }));
    expect(filters).toContainEqual(['status', 'active']);
  });
  it('does not acknowledge failed delivery and retries with exactly the same idempotency key', async () => {
    deliveryFails = true;
    expect(await finishTurn('execution-1', 'failed')).toMatchObject({ state: 'failed', notice_pending: true });
    expect(events).not.toContain('app_ack_turn_notice');
    deliveryFails = false;
    expect(await recoverStalledTurns()).toMatchObject({ delivered: 1, failures: 0 });
    expect(claims[0].notice_pending).toBe(false);
    expect(new Set(mocks.deliver.mock.calls.map(c => c[2].idempotency)).size).toBe(1);
  });
  it('retries a persisted notice after acknowledgement failure without creating another notice', async () => {
    ackFails = true;
    expect(await finishTurn('execution-1', 'failed')).toMatchObject({ notice_pending: true });
    expect(stored.size).toBe(1);
    ackFails = false;
    await recoverStalledTurns();
    expect(stored.size).toBe(1);
    expect(claims[0].notice_pending).toBe(false);
  });
  it('does not invent turns for unknown or historical executions', async () => {
    claims[0].state = 'legacy';
    for (const execution of ['execution-1', 'unknown']) expect(await finishTurn(execution, 'failed')).toEqual({ matched: false, changed: false });
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('retains failed state on late success and never emits contradictory notices', async () => {
    await finishTurn('execution-1', 'failed');
    expect(await finishTurn('execution-1', 'completed')).toMatchObject({ changed: false, state: 'failed', notice_pending: false });
    expect(mocks.deliver).toHaveBeenCalledTimes(1);
  });
  it('keeps another active turn typing when an older turn fails', async () => {
    claims.push({ ...claim('running', 1_000), message_id: '33333333-3333-4333-8333-333333333333', execution: 'execution-2' });
    await finishTurn('execution-1', 'failed');
    expect(typing).toBe(true);
    expect(mocks.deliver.mock.calls[0][2].preserveTyping).toBe(true);
  });
  it.each([['', 'failed'], [' '.repeat(3), 'completed'], ['x'.repeat(201), 'failed'], ['execution-1', 'timed_out']])('rejects invalid finish input %s/%s', async (execution, outcome) => {
    await expect(finishTurn(execution, outcome as any)).rejects.toMatchObject({ status: 400 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not expose raw DB errors to the internal caller', async () => {
    mocks.rpc.mockReturnValue(builder(() => response(null, { message: 'private_database_details' })));
    await expect(finishTurn('execution-1', 'failed')).rejects.toMatchObject({ status: 503, code: 'turn_storage_unavailable' });
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
});

describe('bounded watchdog and conservative terminal semantics', () => {
  it('times out at ten minutes but never times out legacy, completed, or fresh claims', async () => {
    claims = [claim('legacy'), { ...claim('completed'), message_id: '33333333-3333-4333-8333-333333333333' },
      { ...claim('running', 599_999), message_id: '44444444-4444-4444-8444-444444444444' }];
    expect(await recoverStalledTurns()).toMatchObject({ examined: 0, delivered: 0 });
    claims.push({ ...claim('running', 600_000), message_id: mid });
    expect(await recoverStalledTurns()).toMatchObject({ examined: 1, timed_out: 1, delivered: 1 });
    expect(botStatuses.get(mid)).toBe('timed_out');
    expect(typing).toBe(true); // the fresh running claim remains active
  });
  it('makes timed_out absorbing even for a later successful callback', async () => {
    await recoverStalledTurns();
    expect(await finishTurn('execution-1', 'completed')).toMatchObject({ changed: false, state: 'timed_out' });
    await recoverStalledTurns();
    expect(mocks.deliver).toHaveBeenCalledTimes(1);
    expect(stored.size).toBe(1);
  });
  it('retains a pending timeout notice through a late completion and failed send', async () => {
    deliveryFails = true;
    await recoverStalledTurns();
    await finishTurn('execution-1', 'completed');
    expect(claims[0]).toMatchObject({ state: 'timed_out', notice_pending: true });
    expect(events).not.toContain('app_ack_turn_notice');
    deliveryFails = false;
    await recoverStalledTurns();
    expect(stored.size).toBe(1);
  });
  it('requires active user even if blocked after the recovery transaction', async () => {
    mocks.from.mockImplementation(() => builder(() => response([])));
    expect(await recoverStalledTurns()).toMatchObject({ delivered: 0 });
    expect(claims[0].notice_pending).toBe(true);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it('limits each batch to ten and accesses app tables/RPCs only', async () => {
    claims = Array.from({ length: 20 }, (_, n) => ({ ...claim(), message_id: `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`, execution: `execution-${n}` }));
    expect(await recoverStalledTurns()).toMatchObject({ examined: 10, timed_out: 10, delivered: 10 });
    expect(mocks.deliver).toHaveBeenCalledTimes(10);
    expect(mocks.from.mock.calls.every(([table]) => table === 'app_users')).toBe(true);
    expect(mocks.rpc.mock.calls.every(([name]) => ['app_recover_turns', 'app_ack_turn_notice'].includes(name))).toBe(true);
    expect(signals.length).toBeGreaterThan(0);
  });
  it('returns before twenty seconds even if storage ignores cancellation', async () => {
    vi.useFakeTimers();
    mocks.rpc.mockReturnValue({ abortSignal: () => new Promise(() => {}) });
    const task = recoverStalledTurns();
    await vi.advanceTimersByTimeAsync(TURN_LIMITS.budgetMs);
    expect(await task).toMatchObject({ ok: false, failures: 1, budget_reached: true });
    expect(TURN_LIMITS.budgetMs).toBeLessThan(20_000);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it('does not acknowledge a hung delivery and does not start another after deadline', async () => {
    vi.useFakeTimers();
    mocks.deliver.mockImplementation(() => new Promise(() => {}));
    const task = recoverStalledTurns();
    await vi.advanceTimersByTimeAsync(TURN_LIMITS.budgetMs);
    expect(await task).toMatchObject({ delivered: 0, failures: 1, budget_reached: true });
    expect(claims[0].notice_pending).toBe(true);
    expect(events).not.toContain('app_ack_turn_notice');
  });
  it('uses precise saved-message wording without claiming humans were alerted or financial work failed', () => {
    expect(TURN_INTERRUPTION_NOTICE).toContain('interrupted or delayed');
    expect(TURN_INTERRUPTION_NOTICE).toContain('Your message is saved');
    expect(TURN_INTERRUPTION_NOTICE).toContain('check Quotes before requesting a duplicate');
    expect(TURN_INTERRUPTION_NOTICE).not.toMatch(/alerted|notified|team|refunded|payment failed|nothing was|retrying|resending/i);
  });
});
