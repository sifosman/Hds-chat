import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import type { Me, Msg, OutboxItem } from './types';

const db = SQLite.openDatabaseSync('hds-chat.db');
db.execSync(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, client_id TEXT, phone TEXT, created_at TEXT, json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
  CREATE TABLE IF NOT EXISTS outbox (
    client_id TEXT PRIMARY KEY, created_at TEXT, json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

// Writes are serialized through one queue; the fence is re-checked at the head of
// the queue, so a stale async response can never repopulate a logged-out DB.
let queue: Promise<unknown> = Promise.resolve();
export function localWrite(isCurrent: () => boolean, action: () => Promise<unknown> | unknown): Promise<void> {
  const run = queue.catch(() => {}).then(async () => { if (isCurrent()) await action(); });
  queue = run.then(() => {}, () => {});
  return run;
}

export const ldb = {
  messagesByPhone(phone: string): Msg[] {
    return db.getAllSync<{ json: string }>('SELECT json FROM messages WHERE phone = ?', phone).map(r => JSON.parse(r.json));
  },
  // Server acknowledgement + outbox removal in one transaction: an ack can never
  // leave a phantom pending row behind, and a crash mid-write can't lose either side.
  acknowledge(msg: Msg, clientId: string) {
    db.withTransactionSync(() => {
      const { localUri, ...rest } = msg;
      db.runSync('INSERT OR REPLACE INTO messages (id, client_id, phone, created_at, json) VALUES (?,?,?,?,?)',
        msg.id, msg.client_id || null, msg.phone || '', msg.created_at, JSON.stringify(rest));
      db.runSync('DELETE FROM outbox WHERE client_id = ?', clientId);
    });
  },
  putMessages(rows: Msg[]) {
    db.withTransactionSync(() => {
      for (const m of rows) {
        const { localUri, ...rest } = m;
        db.runSync('INSERT OR REPLACE INTO messages (id, client_id, phone, created_at, json) VALUES (?,?,?,?,?)',
          m.id, m.client_id || null, m.phone || '', m.created_at, JSON.stringify(rest));
      }
    });
  },
  getOutbox(): OutboxItem[] {
    return db.getAllSync<{ json: string }>('SELECT json FROM outbox ORDER BY created_at').map(r => JSON.parse(r.json));
  },
  getOutboxItem(clientId: string): OutboxItem | null {
    const r = db.getFirstSync<{ json: string }>('SELECT json FROM outbox WHERE client_id = ?', clientId);
    return r ? JSON.parse(r.json) : null;
  },
  putOutbox(item: OutboxItem) {
    db.runSync('INSERT OR REPLACE INTO outbox (client_id, created_at, json) VALUES (?,?,?)', item.client_id, item.created_at, JSON.stringify(item));
  },
  deleteOutbox(clientId: string) { db.runSync('DELETE FROM outbox WHERE client_id = ?', clientId); },
};

export async function kvGet<T>(k: string, d: T): Promise<T> {
  const r = db.getFirstSync<{ v: string }>('SELECT v FROM kv WHERE k = ?', k);
  return r ? (JSON.parse(r.v) as T) : d;
}
export async function kvSet(k: string, v: unknown) { db.runSync('INSERT OR REPLACE INTO kv (k, v) VALUES (?,?)', k, JSON.stringify(v)); }

export function wipeLocal() {
  return localWrite(() => true, () => db.withTransactionSync(() => {
    db.runSync('DELETE FROM messages'); db.runSync('DELETE FROM outbox'); db.runSync('DELETE FROM kv');
  }));
}

// Bind the offline identity cache to the exact app session, without storing another
// plaintext copy of the bearer token. A newly set token must not expose an old user.
async function sessionTag(token: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token);
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
