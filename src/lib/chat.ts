// Local-first chat with durable outbox and generation-fenced asynchronous work.
// Broadcasts are untrusted wake-up hints; only authenticated API responses carry data.
import { RealtimeClient, RealtimeChannel } from '@supabase/realtime-js';
import { api, ApiError, auth, getConfig } from './api';
import { ldb, kvGet, kvSet, localWrite } from './localdb';
import type { Me, Msg, OutboxItem } from './types';

type State = {
  me: Me | null; messages: Msg[]; history: Msg[]; historyLoaded: boolean; historyMore: boolean;
  typingUntil: number; online: boolean; connected: boolean; loaded: boolean;
};
const empty = (): State => ({ me: null, messages: [], history: [], historyLoaded: false, historyMore: true, typingUntil: 0, online: navigator.onLine, connected: false, loaded: false });
let state = empty();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const set = (p: Partial<State>) => { state = { ...state, ...p }; emit(); };
export const chat = { get: () => state, subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); } };

type Run = {
  me: Me; token: string | null; abort: AbortController; syncing: boolean; syncAgain: boolean; processing: boolean;
  rt?: RealtimeClient; channel?: RealtimeChannel; interval?: ReturnType<typeof setInterval>;
  retryTimer?: ReturnType<typeof setTimeout>; syncTimer?: ReturnType<typeof setTimeout>;
  backoff: number; lastPoke: number; blobs: Set<string>; connecting: boolean; historyLoading: boolean; olderLoading: boolean;
};
let current: Run | null = null;
const alive = (run: Run) => current === run && !run.abort.signal.aborted && auth.token === run.token;
const writeFor = (run: Run, action: () => Promise<unknown>) => localWrite(() => alive(run), action);
const byTime = (a: Msg, b: Msg) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id);
const rank: Record<string, number> = { sending: 0, failed: 0, sent: 1, delivered: 2, read: 3 };
const revoke = (run: Run, url?: string) => { if (url && run.blobs.delete(url)) URL.revokeObjectURL(url); };

async function merge(run: Run, incoming: Msg[], persist = true) {
  if (!alive(run) || !incoming.length) return;
  const map = new Map(state.messages.map(m => [m.id, m]));
  for (const item of incoming) {
    const m = { ...item, phone: run.me.phone };
    const local = m.client_id ? map.get('local:' + m.client_id) : undefined;
    if (local && local.id !== m.id) {
      map.delete(local.id);
      if (local.localBlobUrl && !m.media_url) m.localBlobUrl = local.localBlobUrl;
      else revoke(run, local.localBlobUrl);
    }
    const prev = map.get(m.id);
    if (prev && (rank[prev.status] ?? 0) > (rank[m.status] ?? 0)) m.status = prev.status;
    if (m.media_url) { revoke(run, prev?.localBlobUrl); m.localBlobUrl = undefined; }
    map.set(m.id, { ...prev, ...m });
  }
  set({ messages: [...map.values()].sort(byTime), typingUntil: incoming.some(m => m.direction === 'out') ? 0 : state.typingUntil });
  if (persist) {
    const rows = incoming.filter(m => !m.id.startsWith('local:')).map(m => ({ ...map.get(m.id)!, localBlobUrl: undefined }));
    if (rows.length) await writeFor(run, () => ldb.messages.bulkPut(rows));
  }
}
function patch(run: Run, id: string, p: Partial<Msg>) {
  if (alive(run)) set({ messages: state.messages.map(m => m.id === id ? { ...m, ...p } : m) });
}
const quietly = (work: Promise<unknown>) => { void work.catch(() => {}); };

// ---------------------------------------------------------------- lifecycle
export async function start(me: Me) {
  stop();
  const run: Run = { me, token: auth.token, abort: new AbortController(), syncing: false, syncAgain: false, processing: false, backoff: 0, lastPoke: 0, blobs: new Set(), connecting: false, historyLoading: false, olderLoading: false };
  current = run;
  set({ ...empty(), me });
  // Register reconnect hooks before any network request. Offline startup must complete.
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
  run.interval = setInterval(() => { if (alive(run) && document.visibilityState === 'visible') { quietly(sync()); quietly(processOutbox()); quietly(connect(run)); } }, 45_000);
  try {
    const [local, pending] = await Promise.all([ldb.messages.where('phone').equals(me.phone).toArray(), ldb.outbox.toArray()]);
    if (!alive(run)) return;
    const confirmed = new Set(local.map(m => m.client_id).filter(Boolean));
    const pendingMsgs = pending.filter(o => o.phone === me.phone && !confirmed.has(o.client_id)).map(o => localMsg(run, o));
    set({ messages: [...local, ...pendingMsgs].sort(byTime), loaded: true });
  } catch {
    if (alive(run)) set({ loaded: true });
  }
  if (!alive(run)) return;
  // Do not make cached messages/outbox depend on config, realtime, or an API being reachable.
  quietly(connect(run));
  quietly(processOutbox());
  quietly(api('/messages/retry', { method: 'POST', signal: run.abort.signal }));
  await sync();
}

export function stop() {
  const run = current;
  current = null; // Fence every callback before cleanup can trigger more callbacks.
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
  document.removeEventListener('visibilitychange', onVisible);
  if (run) {
    run.abort.abort();
    clearInterval(run.interval); clearTimeout(run.retryTimer); clearTimeout(run.syncTimer);
    if (run.channel) quietly(run.channel.unsubscribe());
    run.rt?.disconnect();
    for (const url of run.blobs) URL.revokeObjectURL(url);
    run.blobs.clear();
  }
  state = empty(); emit();
}
const onOnline = () => { const run = current; if (!run || !alive(run)) return; set({ online: true }); quietly(sync()); quietly(processOutbox()); quietly(connect(run)); };
const onOffline = () => { if (current && alive(current)) set({ online: false, connected: false }); };
const onVisible = () => { if (document.visibilityState === 'visible') onOnline(); };

async function connect(run: Run) {
  if (!alive(run) || run.rt || run.connecting) return;
  run.connecting = true;
  try {
    const cfg = await getConfig();
    if (!alive(run)) return;
    run.rt = new RealtimeClient(cfg.supabase_url.replace(/^http/, 'ws') + '/realtime/v1', { params: { apikey: cfg.supabase_key } });
    run.channel = run.rt.channel(run.me.topic, { config: { broadcast: { self: false } } });
    run.channel.on('broadcast', { event: 'app' }, ({ payload }) => {
      if (!alive(run) || payload?.type !== 'sync' || Date.now() - run.lastPoke < 500) return;
      run.lastPoke = Date.now(); quietly(sync());
    });
    run.channel.subscribe(status => {
      if (!alive(run)) return;
      const connected = status === 'SUBSCRIBED';
      set({ connected });
      if (connected) quietly(sync());
    });
  } catch {
    if (alive(run)) set({ connected: false });
  } finally { run.connecting = false; }
}

type Page = { messages: Msg[]; has_more?: boolean; next_cursor?: { created_at: string; id: string } | null; typing_until?: string | null };
export async function sync() {
  const run = current;
  if (!run || !alive(run)) return;
  if (run.syncing) { run.syncAgain = true; return; }
  run.syncing = true;
  try {
    const last = [...state.messages].reverse().find(m => !m.id.startsWith('local:'));
    let after = last ? new Date(Date.parse(last.created_at) - 120_000).toISOString() : '';
    let afterId = '';
    // Catch-up pages are ascending. Do not jump to the newest page and lose >200 missed messages.
    for (;;) {
      const q = new URLSearchParams({ limit: after ? '200' : '80' });
      if (after) q.set('after', after);
      if (afterId) q.set('after_id', afterId);
      const r = await api<Page>('/messages?' + q, { signal: run.abort.signal });
      if (!alive(run)) return;
      await merge(run, r.messages);
      if (!alive(run)) return;
      const typing = r.typing_until ? Date.parse(r.typing_until) : 0;
      set({ online: true, typingUntil: Number.isFinite(typing) ? typing : 0 });
      if (!after || !(r.has_more ?? r.messages.length === 200) || !r.messages.length) break;
      const next = r.next_cursor || [...r.messages].sort(byTime).at(-1)!;
      if (next.created_at === after && next.id === afterId) break; // defensive non-progress guard
      after = next.created_at; afterId = next.id;
    }
  } catch (e) {
    if (alive(run) && (e as ApiError).code === 'offline') set({ online: false });
  } finally {
    run.syncing = false;
    if (alive(run) && run.syncAgain) { run.syncAgain = false; run.syncTimer = setTimeout(() => { if (alive(run)) quietly(sync()); }, 500); }
  }
}

export async function loadHistory() {
  const run = current;
  if (!run || !alive(run) || !state.historyMore || run.historyLoading) return;
  run.historyLoading = true;
  try {
    const oldest = state.history[0];
    const q = new URLSearchParams();
    if (oldest) { q.set('before', oldest.created_at); q.set('before_id', oldest.id); }
    const r = await api<Page>('/history?' + q, { signal: run.abort.signal });
    if (!alive(run)) return;
    const rows = new Map([...r.messages, ...state.history].map(m => [m.id, m]));
    set({ history: [...rows.values()].sort(byTime), historyLoaded: true, historyMore: !!r.has_more });
  } finally { run.historyLoading = false; }
}
export async function loadOlder() {
  const run = current;
  if (!run || !alive(run) || run.olderLoading) return 0;
  const oldest = state.messages.find(m => !m.id.startsWith('local:'));
  if (!oldest) return 0;
  run.olderLoading = true;
  try {
    const q = new URLSearchParams({ before: oldest.created_at, before_id: oldest.id, limit: '80' });
    const r = await api<Page>('/messages?' + q, { signal: run.abort.signal });
    if (!alive(run)) return 0;
    await merge(run, r.messages);
    return alive(run) ? r.messages.length : 0;
  } finally { run.olderLoading = false; }
}

// ---------------------------------------------------------------- sending
const cid = () => crypto.randomUUID().replace(/-/g, '');
function localMsg(run: Run, o: OutboxItem): Msg {
  const url = o.blob ? URL.createObjectURL(o.blob) : undefined;
  if (url) run.blobs.add(url);
  return { id: 'local:' + o.client_id, client_id: o.client_id, phone: o.phone, direction: 'in', sender: 'customer', type: o.type, body: o.body || null,
    payload: { filename: o.filename, mime: o.mime, ...(o.location ? { location: o.location } : {}) },
    status: o.attempts > 5 ? 'failed' : 'sending', created_at: o.created_at, localBlobUrl: url };
}
export async function send(p: Omit<OutboxItem, 'client_id' | 'phone' | 'created_at' | 'attempts'>) {
  const run = current;
  if (!run || !alive(run)) return;
  const item: OutboxItem = { ...p, client_id: cid(), phone: run.me.phone, created_at: new Date().toISOString(), attempts: 0 };
  await writeFor(run, () => ldb.outbox.put(item));
  if (!alive(run)) return;
  await merge(run, [localMsg(run, item)], false);
  quietly(processOutbox());
}
export async function processOutbox() {
  const run = current;
  if (!run || !alive(run) || run.processing) return;
  run.processing = true;
  clearTimeout(run.retryTimer);
  try {
    while (alive(run)) {
      const items = await ldb.outbox.orderBy('created_at').toArray();
      if (!alive(run)) return;
      const item = items.find(o => o.phone === run.me.phone && o.attempts <= 5);
      if (!item) break;
      try {
        if (item.blob && !item.media_id) {
          const u = await api<{ media_id: string; upload_url: string }>('/media/upload-url', { method: 'POST', body: { mime: item.mime, size: item.blob.size, filename: item.filename }, signal: run.abort.signal });
          if (!alive(run)) return;
          let put: Response;
          try { put = await fetch(u.upload_url, { method: 'PUT', headers: { 'Content-Type': item.mime || 'application/octet-stream' }, body: item.blob, signal: run.abort.signal }); }
          catch { throw new ApiError(0, 'offline', 'Upload interrupted'); }
          if (!alive(run)) return;
          if (!put.ok) throw new ApiError(put.status, 'upload_failed', 'Upload failed');
          item.media_id = u.media_id;
          await writeFor(run, () => ldb.outbox.put(item));
        }
        if (!alive(run)) return;
        const r = await api<{ message: Msg }>('/messages', { method: 'POST', body: { client_id: item.client_id, type: item.type, body: item.body, media_id: item.media_id, location: item.location }, signal: run.abort.signal });
        if (!alive(run)) return;
        // Persist acknowledgement and remove its outbox row atomically before updating the view.
        await writeFor(run, async () => { await ldb.messages.put({ ...r.message, phone: run.me.phone, localBlobUrl: undefined }); await ldb.outbox.delete(item.client_id); });
        if (!alive(run)) return;
        await merge(run, [r.message], false);
        run.backoff = 0;
      } catch (e) {
        if (!alive(run)) return;
        const err = e as ApiError;
        const retryable = err.status === 0 || err.status >= 500 || err.status === 429 || err.status === 408 || (err.code === 'upload_failed' && (err.status === 401 || err.status === 403));
        item.attempts = retryable ? item.attempts + (err.status === 0 ? 0 : 1) : 99;
        await writeFor(run, () => ldb.outbox.put(item));
        if (!alive(run)) return;
        if (!retryable || item.attempts > 5) { patch(run, 'local:' + item.client_id, { status: 'failed' }); continue; }
        if (err.status === 0) set({ online: false });
        run.backoff = Math.min(30_000, (run.backoff || 1000) * 2);
        run.retryTimer = setTimeout(() => { if (alive(run)) quietly(processOutbox()); }, run.backoff);
        break;
      }
    }
  } finally { run.processing = false; }
}
export async function retry(m: Msg) {
  const run = current;
  if (!run || !alive(run) || !m.client_id) return;
  const item = await ldb.outbox.get(m.client_id);
  if (!alive(run) || !item || item.phone !== run.me.phone) return;
  item.attempts = 0;
  await writeFor(run, () => ldb.outbox.put(item));
  if (!alive(run)) return;
  patch(run, m.id, { status: 'sending' }); quietly(processOutbox());
}
export async function discard(m: Msg) {
  const run = current;
  if (!run || !alive(run)) return;
  if (m.client_id) {
    const item = await ldb.outbox.get(m.client_id);
    if (!alive(run) || (item && item.phone !== run.me.phone)) return;
    await writeFor(run, () => ldb.outbox.delete(m.client_id!));
  }
  if (!alive(run)) return;
  revoke(run, state.messages.find(x => x.id === m.id)?.localBlobUrl);
  set({ messages: state.messages.filter(x => x.id !== m.id) });
}
export const seenKey = 'seen-at';
export const markSeen = () => { const run = current; return run ? writeFor(run, () => kvSet(seenKey + ':' + run.me.id, new Date().toISOString())) : Promise.resolve(); };
export const getSeen = () => current ? kvGet(seenKey + ':' + current.me.id, '') : Promise.resolve('');
