import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ stores: {} as Record<string, Map<string, any>>, queue: Promise.resolve(), pause: null as Promise<void> | null, schemas: [] as unknown[] }));
vi.mock('dexie', () => ({ default: class {
  messages: any; outbox: any; kv: any;
  version() { return { stores: (schema: unknown) => {
    f.schemas.push(schema);
    for (const name of ['messages', 'outbox', 'kv']) {
      const rows = f.stores[name] ||= new Map();
      (this as any)[name] = { get: async (key: string) => rows.get(key), put: async (row: any) => { rows.set(row.k ?? row.id ?? row.client_id, row); }, clear: async () => { rows.clear(); } };
    }
  } }; }
  transaction(...args: any[]) {
    const action = args.at(-1);
    const next = f.queue.then(async () => { if (f.pause) await f.pause; await action(); });
    f.queue = next.catch(() => {}); return next;
  }
} }));
// Dynamic browser-module import keeps the server NodeNext typecheck independent of
// the frontend's bundler module resolution; frontend source is checked by tsconfig.json.
let cachedUser: any, cacheUser: any, ldb: any, localWrite: any, wipeLocal: any;
beforeAll(async () => { ({ cachedUser, cacheUser, ldb, localWrite, wipeLocal } = await import('../src/lib/' + 'localdb')); });
const user = { id: 'fixture', phone: '27900000001', name: 'Fixture', topic: 'fixture-topic' };
beforeEach(async () => { await f.queue; f.pause = null; for (const rows of Object.values(f.stores)) rows.clear(); });

describe('transaction-fenced local persistence', () => {
  it('rejects a stale write that was queued before logout but executes after wipe', async () => {
    let release!: () => void;
    f.pause = new Promise<void>(r => { release = r; });
    let valid = true;
    const wipe = wipeLocal();
    const late = localWrite(() => valid, async () => { await ldb.kv.put({ k: 'private', v: 'stale' }); });
    valid = false;
    release(); await wipe; await late; f.pause = null;
    expect(f.stores.kv.size).toBe(0);
  });
  it('clears cached messages, queued blobs, and session metadata together', async () => {
    await ldb.messages.put({ id: 'fixture' } as any);
    await ldb.outbox.put({ client_id: 'fixture', blob: new Blob(['attachment']) } as any);
    await ldb.kv.put({ k: 'fixture', v: true });
    await wipeLocal();
    expect(Object.values(f.stores).every(rows => rows.size === 0)).toBe(true);
  });
  it('binds the offline identity to an exact session without persisting the bearer token', async () => {
    await cacheUser('opaque-session-a', user, () => true);
    await expect(cachedUser('opaque-session-a')).resolves.toEqual(user);
    await expect(cachedUser('opaque-session-b')).resolves.toBeNull();
    expect(JSON.stringify([...f.stores.kv.values()])).not.toContain('opaque-session-a');
  });
  it('does not repopulate the identity cache when login generation expires during hashing', async () => {
    await cacheUser('opaque-session-a', user, () => false);
    await expect(cachedUser('opaque-session-a')).resolves.toBeNull();
  });
  it('never trusts legacy unbound identity caches for a new session', async () => {
    await ldb.kv.put({ k: 'me', v: user });
    await expect(cachedUser('opaque-new-session')).resolves.toBeNull();
  });
});
