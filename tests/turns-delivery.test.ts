import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), broadcast: vi.fn(), push: vi.fn(), quote: vi.fn() }));
vi.mock('../server/db.js', () => ({ db: () => ({ from: mocks.from }), broadcast: mocks.broadcast, event: vi.fn(), rateOk: vi.fn() }));
vi.mock('../server/push.js', () => ({ pushToUser: mocks.push }));
vi.mock('../server/quotes.js', () => ({ getQuote: mocks.quote }));
import { deliverOutbound } from '../server/messages.js';
import type { AppUser } from '../server/auth.js';
const user: AppUser = { id: '11111111-1111-4111-8111-111111111111', phone: '27821234567', status: 'active', name: null,
  realtime_topic: 'test', created_at: '2026-10-21T10:00:00Z', wa_history_cutoff: '2026-10-21T10:00:00Z' };
let calls: { table: string; action: string; value?: any }[], inserted: any, signals: AbortSignal[];
beforeEach(() => {
  vi.clearAllMocks(); calls = []; inserted = null; signals = [];
  mocks.broadcast.mockResolvedValue(undefined); mocks.push.mockResolvedValue({ sent: 0 }); mocks.quote.mockReset().mockResolvedValue(null);
  mocks.from.mockImplementation((table: string) => {
    const call = { table, action: 'select', value: undefined as any }; calls.push(call);
    const q: any = {
      select() { return this; }, eq() { return this; },
      insert(value: any) { call.action = 'insert'; call.value = value; return this; },
      update(value: any) { call.action = 'update'; call.value = value; return this; },
      abortSignal(signal: AbortSignal) { signals.push(signal); return this; },
      single() { return this; }, maybeSingle() { return this; },
      then(ok: any, fail: any) {
        if (call.action === 'insert') inserted = { ...call.value, id: 'outbound-1' };
        return Promise.resolve({ data: table === 'app_messages' ? inserted : null, error: null }).then(ok, fail);
      },
    }; return q;
  });
});
describe('quote PDF access does not depend on AI URL wording', () => {
  it('attaches one owned quote card to a text-only quote reply', async () => {
    const q = { quote_number: 'Q-20260101-0001-TEST', total: 2720, pdf_url: 'https://example.invalid/quote.pdf' };
    mocks.quote.mockResolvedValue(q);
    const m = await deliverOutbound(user, { type: 'text', body: 'Your quote Q-20260101-0001-TEST is ready.', payload: {} }, { sender: 'bot' });
    expect(m.type).toBe('text'); expect(m.payload.quote).toEqual(q);
    expect(mocks.quote).toHaveBeenCalledWith(user.phone, q.quote_number);
  });
  it('never enriches an unowned quote reference', async () => {
    const m = await deliverOutbound(user, { type: 'text', body: 'Quote Q-20260101-0002-TEST', payload: {} }, { sender: 'bot' });
    expect(m.payload.quote).toBeUndefined();
  });
  it('does not pick an arbitrary quote from a comparison', async () => {
    const m = await deliverOutbound(user, { type: 'text', body: 'Compare Q-20260101-0001-TEST and Q-20260101-0002-TEST', payload: {} }, { sender: 'bot' });
    expect(m.payload.quote).toBeUndefined(); expect(m.payload.quote_refs).toHaveLength(2); expect(mocks.quote).not.toHaveBeenCalled();
  });
});
describe('recovery notices do not clear newer typing', () => {
  it('honors preserveTyping and abort signal through insert and idempotent re-delivery', async () => {
    const signal = new AbortController().signal;
    const opts = { sender: 'system' as const, preserveTyping: true, signal, idempotency: 'turn-interrupted:inbound-1' };
    const first = await deliverOutbound(user, { type: 'system', body: 'Your message is saved.', payload: {} }, opts);
    const again = await deliverOutbound(user, { type: 'system', body: 'Your message is saved.', payload: {} }, opts);
    expect(again.id).toBe(first.id);
    expect(calls.filter(c => c.action === 'insert')).toHaveLength(1);
    expect(calls.some(c => c.table === 'app_users')).toBe(false);
    expect(signals.length).toBe(3);
    expect(signals.every(s => s === signal)).toBe(true);
    expect(mocks.quote).not.toHaveBeenCalled();
  });
  it('preserves existing default typing behavior for non-recovery outbound messages', async () => {
    await deliverOutbound(user, { type: 'text', body: 'Reply', payload: {} }, { sender: 'bot' });
    expect(calls).toContainEqual({ table: 'app_users', action: 'update', value: { typing_until: null } });
  });
  it('does not start work when the recovery deadline is already aborted', async () => {
    const controller = new AbortController(); controller.abort(new Error('deadline'));
    await expect(deliverOutbound(user, { type: 'system', body: 'Saved', payload: {} }, { sender: 'system', preserveTyping: true, signal: controller.signal })).rejects.toThrow('deadline');
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('returns on deadline during fan-out without changing typing; stored message remains idempotent', async () => {
    const controller = new AbortController();
    mocks.broadcast.mockImplementation(() => { controller.abort(new Error('deadline')); return new Promise(() => {}); });
    await expect(deliverOutbound(user, { type: 'system', body: 'Saved', payload: {} }, {
      sender: 'system', idempotency: 'turn-interrupted:inbound-1', preserveTyping: true, signal: controller.signal,
    })).rejects.toThrow('deadline');
    expect(inserted).not.toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(calls.some(c => c.table === 'app_users')).toBe(false);
  });
});
