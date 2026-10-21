import Dexie, { Table } from 'dexie';
import type { Me, Msg, OutboxItem } from './types';

class LocalDB extends Dexie {
  messages!: Table<Msg, string>;
  outbox!: Table<OutboxItem, string>;
  kv!: Table<{ k: string; v: any }, string>;
  constructor() {
    super('hds-chat');
    this.version(1).stores({
      messages: 'id, client_id, created_at, phone',
      outbox: 'client_id, created_at',
      kv: 'k',
    });
  }
}
export const ldb = new LocalDB();

export async function kvGet<T>(k: string, d: T): Promise<T> { return ((await ldb.kv.get(k))?.v as T) ?? d; }
export async function kvSet(k: string, v: unknown) { await ldb.kv.put({ k, v }); }
// The fence is checked INSIDE the transaction, after waiting behind any earlier
// writes/wipe. A stale async response can therefore never repopulate a logged-out DB.
export async function localWrite(isCurrent: () => boolean, action: () => Promise<unknown>): Promise<void> {
  await ldb.transaction('rw', ldb.messages, ldb.outbox, ldb.kv, async () => {
    if (isCurrent()) await action();
  });
}
export async function wipeLocal() {
  await ldb.transaction('rw', ldb.messages, ldb.outbox, ldb.kv, async () => {
    await ldb.messages.clear(); await ldb.outbox.clear(); await ldb.kv.clear();
  });
}

// Bind the offline identity cache to the exact app session, without storing another
// plaintext copy of the bearer token. A newly set token must not expose an old user.
async function sessionTag(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export async function cachedUser(token: string): Promise<Me | null> {
  const tag = await sessionTag(token);
  const row = await kvGet<{ tag: string; user: Me } | null>('session-user', null);
  return row?.tag === tag ? row.user : null;
}
export async function cacheUser(token: string, user: Me, isCurrent: () => boolean) {
  const tag = await sessionTag(token);
  await localWrite(isCurrent, () => kvSet('session-user', { tag, user }));
}
