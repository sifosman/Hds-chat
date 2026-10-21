import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: f.rpc }) }));
vi.mock('../server/env.js', () => ({ ENV: { SUPABASE_URL: 'https://example.invalid', SUPABASE_SECRET_KEY: 'test-only-key' } }));
import { broadcast, rateOk } from '../server/db.js';
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('fail-closed rate limiter', () => {
  it('permits only explicit true', async () => {
    f.rpc.mockResolvedValue({ data: true, error: null });
    await expect(rateOk('test', 60, 5)).resolves.toBe(true);
  });
  it.each([false, null, undefined, 'true', 1, {}, []])('rejects non-boolean approval %j', async data => {
    f.rpc.mockResolvedValue({ data, error: null });
    await expect(rateOk('test', 60, 5)).resolves.toBe(false);
  });
  it('rejects RPC errors even if data claims success, without printing error details', async () => {
    f.rpc.mockResolvedValue({ data: true, error: { message: 'secret-bearing-gateway-url' } });
    await expect(rateOk('test', 60, 5)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledExactlyOnceWith('rate_limit_unavailable');
  });
  it('rejects transport exceptions without printing them', async () => {
    f.rpc.mockRejectedValue(new Error('secret-bearing-gateway-url'));
    await expect(rateOk('test', 60, 5)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledExactlyOnceWith('rate_limit_unavailable');
  });
});

describe('public broadcasts carry no customer content', () => {
  it('strips arbitrary caller payload and emits only a sync hint', async () => {
    await broadcast('fixture-topic', { phone: 'fixture', body: 'private chat', token: 'private token', type: 'message' });
    const call = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(call[1]?.body))).toEqual({ messages: [{ topic: 'fixture-topic', event: 'app', payload: { type: 'sync' }, private: false }] });
  });
  it('does not print secret-bearing transport error details', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('https://example.invalid/private-key'));
    await broadcast('fixture-topic', {});
    expect(console.error).toHaveBeenCalledExactlyOnceWith('broadcast_unavailable');
  });
});
