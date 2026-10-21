import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, Msg, OutboxItem } from '../src/lib/types.js';
const f = vi.hoisted(() => ({ api: vi.fn(), config: vi.fn(), token: 'session-a', messages: new Map<string, Msg>(), outbox: new Map<string, OutboxItem>(), kv: new Map<string, unknown>(), channels: [] as any[], rt: vi.fn(), writes: vi.fn() }));
vi.mock('../src/lib/api', () => ({
  auth: { get token() { return f.token; } }, api: f.api, getConfig: f.config,
  ApiError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } },
}));
vi.mock('../src/lib/localdb', () => ({
  ldb: {
    messages: { where: () => ({ equals: (phone: string) => ({ toArray: async () => [...f.messages.values()].filter(m => m.phone === phone) }) }), bulkPut: async (rows: Msg[]) => { rows.forEach(m => f.messages.set(m.id, structuredClone(m))); }, put: async (m: Msg) => f.messages.set(m.id, structuredClone(m)) },
    outbox: { toArray: async () => [...f.outbox.values()].map(m => structuredClone(m)), orderBy: () => ({ toArray: async () => [...f.outbox.values()].map(m => structuredClone(m)).sort((a, b) => a.created_at.localeCompare(b.created_at)) }), put: async (o: OutboxItem) => f.outbox.set(o.client_id, structuredClone(o)), get: async (id: string) => f.outbox.has(id) ? structuredClone(f.outbox.get(id)) : undefined, delete: async (id: string) => f.outbox.delete(id) },
  },
  localWrite: async (guard: () => boolean, action: () => Promise<unknown>) => { f.writes(); if (guard()) await action(); },
  kvGet: async (k: string, fallback: unknown) => f.kv.get(k) ?? fallback,
  kvSet: async (k: string, v: unknown) => f.kv.set(k, v),
}));
vi.mock('@supabase/realtime-js', () => ({ RealtimeClient: class {
  constructor(...args: any[]) { f.rt(...args); }
  channel() { const ch: any = { on: vi.fn((_event, _filter, cb) => { ch.receive = cb; return ch; }), subscribe: vi.fn(), unsubscribe: vi.fn(async () => {}) }; f.channels.push(ch); return ch; }
  disconnect() {}
} }));
const userA: Me = { id: 'a', phone: '27900000001', name: 'Fixture A', topic: 'topic-a' };
const userB: Me = { id: 'b', phone: '27900000002', name: 'Fixture B', topic: 'topic-b' };
const message = (id: string, phone = userA.phone, time = '2026-01-01T00:00:00.000Z'): Msg => ({ id, phone, direction: 'out', sender: 'bot', type: 'text', payload: {}, status: 'sent', created_at: time, body: id });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
// Browser modules use bundler resolution and are separately checked by tsconfig.json.
let chat: any;
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers();
  f.messages.clear(); f.outbox.clear(); f.kv.clear(); f.channels.length = 0; f.token = 'session-a';
  vi.stubGlobal('window', new EventTarget());
  const doc = new EventTarget(); Object.assign(doc, { visibilityState: 'visible' }); vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { onLine: false });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('simulated network failure'); }));
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fixture-' + Math.random());
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  f.config.mockRejectedValue(new Error('offline'));
  f.api.mockRejectedValue({ status: 0, code: 'offline' });
  chat = await import('../src/lib/' + 'chat');
});
afterEach(() => { chat.stop(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('offline startup and upload durability', () => {
  it('loads cached messages and queued attachment blobs while API/config are offline', async () => {
    f.messages.set('cached', message('cached'));
    f.outbox.set('pending', { client_id: 'pending', phone: userA.phone, type: 'image', blob: new Blob(['fixture']), filename: 'fixture.jpg', created_at: '2026-01-01T00:01:00Z', attempts: 0 });
    await chat.start(userA); await flush();
    expect(chat.chat.get()).toMatchObject({ loaded: true, online: false, connected: false });
    expect(chat.chat.get().messages.map((m: Msg) => m.id)).toEqual(['cached', 'local:pending']);
    expect(chat.chat.get().messages[1].localBlobUrl).toMatch(/^blob:fixture/);
    expect(f.outbox.get('pending')?.blob?.size).toBe(7);
    expect(f.outbox.get('pending')?.attempts).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    chat.stop();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    await chat.start(userA); await flush();
    expect(chat.chat.get().messages).toHaveLength(2);
    expect(f.outbox.get('pending')?.blob?.size).toBe(7);
  });
  it('classifies raw upload network failures as retryable and retries after restart', async () => {
    const item: OutboxItem = { client_id: 'upload', phone: userA.phone, type: 'image', blob: new Blob(['image']), mime: 'image/jpeg', created_at: '2026-01-01T00:01:00Z', attempts: 0 };
    f.outbox.set(item.client_id, item);
    f.api.mockImplementation(async (path: string) => {
      if (path === '/media/upload-url') return { media_id: 'media-fixture', upload_url: 'https://example.invalid/upload' };
      if (path === '/messages') return { message: { ...message('sent'), client_id: 'upload', media_url: 'https://example.invalid/media' } };
      return { messages: [] };
    });
    await chat.start(userA); await flush();
    expect(fetch).toHaveBeenCalledOnce();
    expect(f.outbox.get('upload')?.attempts).toBe(0);
    expect(chat.chat.get().messages[0].status).toBe('sending');
    chat.stop();
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    await chat.start(userA); await flush();
    expect(f.outbox.size).toBe(0);
    expect(chat.chat.get().messages.map((m: Msg) => m.id)).toEqual(['sent']);
    expect(f.messages.get('sent')?.phone).toBe(userA.phone);
  });
  it('reconnect hooks still work after offline startup', async () => {
    await chat.start(userA);
    f.api.mockResolvedValue({ messages: [message('reconnected')] });
    (globalThis as any).window.dispatchEvent(new Event('online')); await flush();
    expect(chat.chat.get().messages.map((m: Msg) => m.id)).toEqual(['reconnected']);
  });
});

describe('generation and session isolation', () => {
  it('ignores stale sync responses after another user signs in', async () => {
    const old = deferred<any>();
    f.api.mockImplementation((path: string) => path.startsWith('/messages?') ? old.promise : Promise.resolve({}));
    const first = chat.start(userA); await flush();
    chat.stop(); f.token = 'session-b';
    f.api.mockResolvedValue({ messages: [message('b-only', userB.phone)] });
    await chat.start(userB);
    old.resolve({ messages: [message('a-private')] }); await first; await flush();
    expect(chat.chat.get().messages.map((m: Msg) => m.id)).toEqual(['b-only']);
    expect(f.messages.has('a-private')).toBe(false);
  });
  it('also ignores stale history on same-user session restart', async () => {
    f.api.mockResolvedValue({ messages: [] }); await chat.start(userA);
    const old = deferred<any>();
    f.api.mockImplementation((path: string) => path.startsWith('/history') ? old.promise : Promise.resolve({ messages: [] }));
    const history = chat.loadHistory();
    chat.stop(); await chat.start(userA);
    old.resolve({ messages: [message('stale-history')], has_more: false }); await history;
    expect(chat.chat.get().history).toEqual([]);
    expect(chat.chat.get().historyLoaded).toBe(false);
  });
  it('does not persist a late send acknowledgement after logout and wipe', async () => {
    const pending = deferred<any>();
    f.outbox.set('sending', { client_id: 'sending', phone: userA.phone, type: 'text', body: 'fixture', created_at: '2026-01-01T00:00:00Z', attempts: 0 });
    f.api.mockImplementation((path: string) => path === '/messages' ? pending.promise : Promise.resolve({ messages: [] }));
    await chat.start(userA); await flush();
    chat.stop(); f.messages.clear(); f.outbox.clear(); f.token = 'session-b';
    await chat.start(userB);
    pending.resolve({ message: { ...message('late-private'), client_id: 'sending' } }); await flush();
    expect(f.messages.size).toBe(0); expect(f.outbox.size).toBe(0);
    expect(chat.chat.get().messages).toEqual([]);
  });
  it('does not start an upload from a stale signed-url response', async () => {
    const pending = deferred<any>();
    f.outbox.set('upload', { client_id: 'upload', phone: userA.phone, type: 'image', blob: new Blob(['x']), created_at: '2026-01-01T00:00:00Z', attempts: 0 });
    f.api.mockImplementation((path: string) => path === '/media/upload-url' ? pending.promise : Promise.resolve({ messages: [] }));
    await chat.start(userA); await flush(); chat.stop(); f.token = 'session-b'; await chat.start(userB);
    pending.resolve({ media_id: 'old', upload_url: 'https://example.invalid/old' }); await flush();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not connect stale config results to a new session', async () => {
    const cfg = deferred<any>(); f.config.mockReturnValue(cfg.promise);
    await chat.start(userA); chat.stop();
    cfg.resolve({ supabase_url: 'https://example.invalid', supabase_key: 'fixture-publishable' }); await flush();
    expect(f.rt).not.toHaveBeenCalled();
  });
  it('cancels retry timers on stop and clears typing/connection state', async () => {
    await chat.start(userA); chat.stop();
    const count = f.api.mock.calls.length;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.api).toHaveBeenCalledTimes(count);
    expect(chat.chat.get()).toMatchObject({ me: null, typingUntil: 0, connected: false, messages: [] });
  });
});

describe('gap-free pagination and untrusted realtime', () => {
  it('drains more than 200 missed messages using timestamp+id cursors', async () => {
    f.messages.set('cached', message('cached'));
    const timestamp = '2026-01-01T00:01:00.000Z';
    const rows = Array.from({ length: 401 }, (_, i) => message('m' + String(i).padStart(3, '0'), userA.phone, timestamp));
    let page = 0;
    f.api.mockImplementation(async (path: string) => {
      if (!path.startsWith('/messages?')) return {};
      const q = new URL('https://example.invalid' + path).searchParams;
      if (page === 1) expect(q.get('after_id')).toBe('m199');
      if (page === 2) expect(q.get('after_id')).toBe('m399');
      const messages = rows.slice(page * 200, ++page * 200);
      return { messages, has_more: page < 3, next_cursor: messages.at(-1) };
    });
    await chat.start(userA);
    expect(page).toBe(3);
    expect(chat.chat.get().messages).toHaveLength(402);
    expect(new Set(chat.chat.get().messages.map((m: Msg) => m.id)).size).toBe(402);
    expect(f.messages.size).toBe(402);
  });
  it('sends tie-breaker ID when requesting older messages', async () => {
    f.messages.set('oldest', message('oldest'));
    f.api.mockResolvedValue({ messages: [] }); await chat.start(userA);
    await chat.loadOlder();
    const older = f.api.mock.calls.find(([path]) => path.includes('before='));
    expect(new URL('https://example.invalid' + older![0]).searchParams.get('before_id')).toBe('oldest');
  });
  it('ignores public message payloads and only refetches on sync hints', async () => {
    f.config.mockResolvedValue({ supabase_url: 'https://example.invalid', supabase_key: 'fixture-publishable' });
    f.api.mockResolvedValue({ messages: [] }); await chat.start(userA); await flush();
    const count = f.api.mock.calls.length;
    f.channels[0].receive({ payload: { type: 'message', message: message('forged') } }); await flush();
    expect(f.api).toHaveBeenCalledTimes(count); expect(chat.chat.get().messages).toEqual([]);
    f.channels[0].receive({ payload: { type: 'sync', message: message('forged') } }); await flush();
    expect(f.api.mock.calls.length).toBeGreaterThan(count); expect(chat.chat.get().messages).toEqual([]);
  });
});
