import test from 'node:test';
import assert from 'node:assert/strict';
import { bootHistory, createHistoryFeed, splitChatCache, type HistoryDeps, type HistoryPatch, type HistoryCursor } from '../src/lib/history.ts';
import { seamActions } from '../src/lib/preview.ts';
import { carouselViewportWidth, singleImageWidth, CAROUSEL_CARD_W } from '../src/lib/bubblelayout.ts';

const flush = () => new Promise<void>(r => setTimeout(r, 0));
function deferred<T = any>() {
  let resolve!: (v: T) => void, reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const msg = (id: string, t: string) => ({ id, created_at: t, payload: { channel: 'whatsapp' } });
type M = ReturnType<typeof msg>;
const byId = (a: M, b: M) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

function rig(over: Partial<HistoryDeps<M>> = {}) {
  const calls = {
    patches: [] as HistoryPatch<M>[], persisted: [] as { rows: string[]; hasMore: boolean }[],
    fetches: [] as (HistoryCursor | null)[], writes: 0,
  };
  const state = { live: true };
  const deps: HistoryDeps<M> = {
    live: () => state.live,

    fetch: cursor => { calls.fetches.push(cursor); return (over.fetch ?? (async () => ({ messages: [], has_more: false })))(cursor, new AbortController().signal); },
    loadCache: over.loadCache ?? (async () => null),
    queueWrite: over.queueWrite ?? ((isCurrent, action) => Promise.resolve(isCurrent() ? (calls.writes++, action(), undefined) : undefined)),
    persist: async (rows, hasMore) => { calls.persisted.push({ rows: rows.map(m => m.id), hasMore }); },
    apply: p => { calls.patches.push(p); },
    keyOf: m => m.id,
    sortBy: byId,
    cursorOf: m => ({ created_at: m.created_at, id: m.id }),
  };
  const feed = createHistoryFeed(deps);
  return { calls, state, deps, feed };
}

test('history: cached rows apply immediately without a fetch', async () => {
  const { calls, feed } = rig({
    loadCache: async () => ({ messages: [msg('wa-2', '2024-01-02T00:00:00Z'), msg('wa-1', '2024-01-01T00:00:00Z')], hasMore: true }),
  });
  await feed.restore();
  assert.deepEqual(calls.fetches, []);
  assert.deepEqual(calls.patches.at(-1)!.rows!.map(m => m.id), ['wa-1', 'wa-2']);
  assert.equal(calls.patches.at(-1)!.hasMore, true);
});

test('history: refresh requests the newest page (no before cursor), dedupes and sorts', async () => {
  const { calls, feed } = rig({
    loadCache: async () => ({ messages: [msg('wa-1', '2024-01-01T00:00:00Z'), msg('wa-2', '2024-01-02T00:00:00Z')], hasMore: true }),
    fetch: async () => ({ messages: [msg('wa-2', '2024-01-02T00:00:00Z'), msg('wa-3', '2024-01-03T00:00:00Z')], has_more: true }),
  });
  await feed.restore();
  await feed.refresh();
  assert.deepEqual(calls.fetches, [null]);
  assert.deepEqual(calls.patches.at(-1)!.rows!.map(m => m.id), ['wa-1', 'wa-2', 'wa-3']);
  assert.equal(calls.writes, 1);
  assert.deepEqual(calls.persisted[0], { rows: ['wa-1', 'wa-2', 'wa-3'], hasMore: true });
});

test('history: older pages strictly before the oldest row; hasMore=false stops paging', async () => {
  const { calls, feed } = rig({
    fetch: async cursor => cursor
      ? { messages: [msg('wa-0', '2023-12-31T00:00:00Z')], has_more: false }
      : { messages: [msg('wa-1', '2024-01-01T00:00:00Z'), msg('wa-2', '2024-01-02T00:00:00Z')], has_more: true },
  });
  await feed.refresh();
  await feed.older();
  assert.deepEqual(calls.fetches[1], { created_at: '2024-01-01T00:00:00Z', id: 'wa-1' });
  assert.deepEqual(calls.patches.at(-1)!.rows!.map(m => m.id), ['wa-0', 'wa-1', 'wa-2']);
  await feed.older();
  assert.equal(calls.fetches.length, 2);
});

test('history: an empty store cannot page older', async () => {
  const { calls, feed } = rig();
  await feed.older();
  assert.deepEqual(calls.fetches, []);
});

test('history: offline refresh keeps the cache and reports a retryable error', async () => {
  const { calls, feed } = rig({
    loadCache: async () => ({ messages: [msg('wa-1', '2024-01-01T00:00:00Z')], hasMore: true }),
    fetch: async () => { throw new Error('No connection.'); },
  });
  await feed.restore();
  await feed.refresh();
  const last = calls.patches.at(-1)!;
  assert.equal(last.error, 'No connection.');
  assert.equal(last.settled, true);
  assert.equal(last.loading, false);
  assert.equal(calls.writes, 0);
  assert.equal(calls.persisted.length, 0);
  assert.deepEqual(calls.patches.find(p => p.rows)?.rows?.map(m => m.id), ['wa-1']);
});

test('history: a response resolving after the run ends cannot render or write', async () => {
  const gate = deferred();
  const { calls, state, feed } = rig({ fetch: () => gate.promise });
  const p = feed.refresh();
  state.live = false;
  gate.resolve({ messages: [msg('wa-9', '2024-01-09T00:00:00Z')], has_more: true });
  await p;
  assert.equal(calls.patches.filter(p2 => p2.rows).length, 0);
  assert.equal(calls.writes, 0);
});

test('history: queued cache write re-fences before touching storage', async () => {
  const writeGate = deferred();
  let queued: { isCurrent: () => boolean; action: () => unknown } | null = null;
  const { calls, state, feed } = rig({
    queueWrite: (isCurrent, action) => {
      queued = { isCurrent, action };
      return writeGate.promise.then(() => { if (isCurrent()) { calls.writes++; action(); } });
    },
  });
  const p = feed.refresh();
  await flush();
  assert.ok(queued);
  state.live = false;
  writeGate.resolve();
  await p;
  assert.equal(calls.writes, 0);
  assert.equal(calls.persisted.length, 0);
});

test('history: restore resolving after close is ignored', async () => {
  const gate = deferred<any>();
  const { calls, feed } = rig({ loadCache: () => gate.promise });
  const p = feed.restore();
  feed.close();
  gate.resolve({ messages: [msg('wa-1', '2024-01-01T00:00:00Z')], hasMore: true });
  await p;
  assert.equal(calls.patches.length, 0);
});

test('history: concurrent refresh/older share a single flight', async () => {
  const { calls, feed } = rig({
    fetch: async () => ({ messages: [msg('wa-1', '2024-01-01T00:00:00Z')], has_more: true }),
  });
  await Promise.all([feed.refresh(), feed.refresh(), feed.older()]);
  assert.equal(calls.fetches.length, 1);
});

test('bubble layout: carousel viewport is explicit, inside the bubble, cards stay fixed', () => {
  for (const screen of [320, 360, 411, 600, 1024]) {
    const w = carouselViewportWidth(screen);
    assert.ok(w >= 160 && w <= 440, `screen ${screen} -> ${w}`);
    assert.ok(w <= 0.82 * (screen - 20) - 18, `viewport ${w} overflows bubble on ${screen}`);
    assert.ok(w < screen, `viewport ${w} overflows screen ${screen}`);
  }
  assert.equal(CAROUSEL_CARD_W, 200);
  assert.ok(carouselViewportWidth(360) > CAROUSEL_CARD_W);
});

test('bubble layout: single image width stays capped', () => {
  assert.equal(singleImageWidth(360), 240);
  assert.equal(singleImageWidth(300), 210);
});

test('history: an exhausted oldest boundary survives overlapping refreshes', async () => {
  const { calls, feed } = rig({
    fetch: async cursor => cursor
      ? { messages: [msg('wa-0', '2023-12-31T00:00:00Z')], has_more: false }
      : { messages: [msg('wa-1', '2024-01-01T00:00:00Z'), msg('wa-2', '2024-01-02T00:00:00Z')], has_more: true },
  });
  await feed.refresh();
  await feed.older();
  assert.equal(calls.patches.at(-1)!.hasMore, false);
  await feed.refresh();
  assert.equal(calls.patches.at(-1)!.hasMore, false);
  await feed.older();
  assert.equal(calls.fetches.length, 3);
});

test('history: restore from an exhausted cache keeps hasMore false through refresh', async () => {
  const { calls, feed } = rig({
    loadCache: async () => ({ messages: [msg('wa-1', '2024-01-01T00:00:00Z')], hasMore: false }),
    fetch: async () => ({ messages: [msg('wa-2', '2024-01-02T00:00:00Z')], has_more: true }),
  });
  await feed.restore();
  await feed.refresh();
  assert.equal(calls.patches.at(-1)!.hasMore, false);
  await feed.older();
  assert.equal(calls.fetches.length, 1);
});

test('history: refresh with no cached rows uses the fresh response hasMore', async () => {
  const { calls, feed } = rig({ fetch: async () => ({ messages: [msg('wa-1', '2024-01-01T00:00:00Z')], has_more: true }) });
  await feed.refresh();
  assert.equal(calls.patches.at(-1)!.hasMore, true);
});

test('splitChatCache: whatsapp rows never seed app messages or confirm pending outbox ids', () => {
  const appMsg = { id: 'a1', phone: '+27', client_id: 'cid-app', payload: {} };
  const waMsg = { id: 'wa-1', phone: '+27', client_id: 'cid-wa', payload: { channel: 'whatsapp' } };
  const otherPhone = { id: 'a2', phone: '+99', client_id: 'cid-other', payload: {} };
  const { app, history, confirmed } = splitChatCache([appMsg, waMsg, otherPhone], '+27');
  assert.deepEqual(app.map(m => m.id), ['a1']);
  assert.deepEqual(history.map(m => m.id), ['wa-1']);
  assert.ok(confirmed.has('cid-app'));
  assert.ok(!confirmed.has('cid-wa'));
  assert.ok(!confirmed.has('cid-other'));
});

test('splitChatCache: mirrored whatsapp rows stay in the live app stream, not history', () => {
  const mirror = { id: 'm1', phone: '+27', client_id: 'wam:abc', payload: { channel: 'whatsapp', wa_mirror: 'abc', wa_mirror_at: '2026-01-01T00:00:00Z' } };
  const old = { id: 'wa-1', phone: '+27', client_id: null, payload: { channel: 'whatsapp' } };
  const { app, history } = splitChatCache([mirror, old], '+27');
  assert.deepEqual(app.map(m => m.id), ['m1']);
  assert.deepEqual(history.map(m => m.id), ['wa-1']);
});

test('bootHistory: restores the cache then fires the first-page fetch without any sync dependency', async () => {
  const { calls, feed } = rig({
    loadCache: async () => ({ messages: [msg('wa-1', '2024-01-01T00:00:00Z')], hasMore: true }),
    fetch: async () => ({ messages: [msg('wa-2', '2024-01-02T00:00:00Z')], has_more: true }),
  });
  await bootHistory(feed);
  assert.deepEqual(calls.fetches, [null]);
  const firstRows = calls.patches.find(p => p.rows)?.rows?.map(m => m.id);
  assert.deepEqual(firstRows, ['wa-1']);
  assert.deepEqual(calls.patches.at(-1)!.rows!.map(m => m.id), ['wa-1', 'wa-2']);
});

test('preview seam: inert actions never call the real send/retry/discard/quote/external', () => {
  const calls = { sent: 0, retried: 0, discarded: 0, quoted: 0, opened: 0, toasts: [] as string[] };
  const ax = seamActions(true, {
    send: async () => { calls.sent++; },
    retry: () => { calls.retried++; },
    discard: () => { calls.discarded++; },
    quote: () => { calls.quoted++; },
    external: () => { calls.opened++; },
  }, m => calls.toasts.push(m));
  assert.equal(ax.disabledActions, true);
  assert.equal(ax.showNotify, false);
  void ax.send({ type: 'text', body: 'hi' });
  ax.retry({} as never); ax.discard({} as never); ax.quote('Q-1'); ax.external('https://x');
  assert.deepEqual([calls.sent, calls.retried, calls.discarded, calls.quoted, calls.opened], [0, 0, 0, 0, 0]);
  assert.equal(calls.toasts.length, 5);
});

test('preview seam: live actions pass straight through', async () => {
  const calls = { sent: 0 };
  const ax = seamActions(false, {
    send: async () => { calls.sent++; },
    retry: () => {}, discard: () => {}, quote: () => {}, external: () => {},
  }, () => {});
  assert.equal(ax.disabledActions, false);
  assert.equal(ax.showNotify, true);
  await ax.send({ type: 'text', body: 'hi' });
  assert.equal(calls.sent, 1);
});
