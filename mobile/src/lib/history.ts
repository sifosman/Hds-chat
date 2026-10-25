export interface HistoryCursor { created_at: string; id: string }
export interface HistoryPage<MsgT> { messages: MsgT[]; has_more: boolean }
export interface HistoryCache<MsgT> { messages: MsgT[]; hasMore: boolean }
export interface HistoryPatch<MsgT> {
  rows?: MsgT[]; hasMore?: boolean; loading?: boolean; settled?: boolean; error?: string | null;
}

export interface HistoryDeps<MsgT> {
  live(): boolean;
  fetch(cursor: HistoryCursor | null, signal: AbortSignal): Promise<HistoryPage<MsgT>>;
  loadCache(): Promise<HistoryCache<MsgT> | null>;
  queueWrite(isCurrent: () => boolean, action: () => unknown): Promise<unknown>;
  persist(rows: MsgT[], hasMore: boolean): Promise<unknown>;
  apply(patch: HistoryPatch<MsgT>): void;
  keyOf(m: MsgT): string;
  sortBy(a: MsgT, b: MsgT): number;
  cursorOf(m: MsgT): HistoryCursor;
}

export interface HistoryFeed {
  restore(): Promise<void>;
  refresh(): Promise<void>;
  older(): Promise<void>;
  close(): void;
}

export const HISTORY_CHANNEL = 'whatsapp';

export function splitChatCache<M extends { phone?: string | null; client_id?: string | null; payload?: Record<string, any> | null }>(rows: M[], phone: string) {
  const mine = rows.filter(m => !m.phone || m.phone === phone);
  const app = mine.filter(m => m.payload?.channel !== HISTORY_CHANNEL);
  const history = mine.filter(m => m.payload?.channel === HISTORY_CHANNEL);
  const confirmed = new Set(app.map(m => m.client_id).filter(Boolean));
  return { app, history, confirmed };
}

export function bootHistory(feed: HistoryFeed) {
  return feed.restore().then(() => feed.refresh());
}

export function createHistoryFeed<MsgT>(d: HistoryDeps<MsgT>): HistoryFeed {
  let mounted = true;
  let rows: MsgT[] = [];
  let hasMore = true;
  let exhausted = false;
  let busy = false;
  let ac: AbortController | null = null;
  const ok = () => mounted && d.live();

  const merge = (incoming: MsgT[]) => {
    const map = new Map(rows.map(m => [d.keyOf(m), m]));
    for (const m of incoming) map.set(d.keyOf(m), m);
    rows = [...map.values()].sort(d.sortBy);
  };

  async function restore() {
    const cached = await d.loadCache().catch(() => null);
    if (!ok() || !cached) return;
    merge(cached.messages);
    hasMore = cached.hasMore;
    exhausted = !cached.hasMore && cached.messages.length > 0;
    d.apply({ rows: [...rows], hasMore });
  }

  async function page(cursor: HistoryCursor | null) {
    if (!ok() || busy) return;
    busy = true;
    ac = new AbortController();
    d.apply({ loading: true, error: null });
    try {
      const hadRows = rows.length > 0;
      const r = await d.fetch(cursor, ac.signal);
      if (!ok()) return;
      merge(r.messages);
      hasMore = cursor ? !!r.has_more : (hadRows && exhausted ? false : !!r.has_more);
      if (cursor && !r.has_more) exhausted = true;
      const snapshot = [...rows];
      const hm = hasMore;
      d.apply({ rows: snapshot, hasMore: hm, loading: false, settled: true, error: null });
      await d.queueWrite(() => ok(), () => d.persist(snapshot, hm));
    } catch (e) {
      if (ok()) d.apply({ loading: false, settled: true, error: e instanceof Error ? e.message : String(e) });
    } finally { busy = false; }
  }

  return {
    restore,
    refresh: () => page(null),
    older: () => (hasMore && rows.length ? page(d.cursorOf(rows[0])) : Promise.resolve()),
    close() { mounted = false; ac?.abort(); ac = null; },
  };
}
