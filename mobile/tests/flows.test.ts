import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceRecorder, type AudioDeps, type NativeRecorder } from '../src/lib/voicerecorder.ts';
import { HoldToTalk, type HoldHooks } from '../src/lib/voicehold.ts';
import { enqueueOutgoing, SendError } from '../src/lib/outboxsend.ts';
import type { OutboxFs } from '../src/lib/outboxstore.ts';
import { createQuotesFeed } from '../src/lib/quotesfeed.ts';
import { RequestGate } from '../src/lib/gate.ts';
import type { OutboxItem } from '../src/lib/types.ts';

const flush = () => new Promise<void>(r => setTimeout(r, 0));
function deferred() {
  let resolve!: (v?: any) => void, reject!: (e?: any) => void;
  const promise = new Promise<any>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------- hold + real recorder

class FakeNative implements NativeRecorder {
  recorded = false; stops = 0; releases = 0; uri: string | null = 'file:///rec.m4a';
  prepareGate = deferred(); stopWait: Promise<unknown> | null = null;
  async prepareToRecordAsync() { await this.prepareGate.promise; }
  record() { this.recorded = true; }
  async stop() { if (this.stopWait) await this.stopWait; this.stops++; }
  release() { this.releases++; }
  getStatus() { return {}; }
}

function sink() {
  const calls = { sent: [] as string[], errors: [] as string[], recordings: 0, idles: 0 };
  const hooks: HoldHooks = {
    onRecording: () => { calls.recordings++; },
    onIdle: () => { calls.idles++; },
    onSend: uri => { calls.sent.push(uri); },
    onError: m => { calls.errors.push(m); },
  };
  return { calls, hooks };
}

test('hold + real recorder: release before permission resolves never creates a recorder', async () => {
  const rec = new FakeNative();
  const perm = deferred();
  const modes: boolean[] = [];
  let created = 0;
  const d: AudioDeps = {
    requestPermission: async () => { await perm.promise; return { granted: true }; },
    setMode: async m => { modes.push(m.allowsRecording); },
    createRecorder: () => { created++; return rec; },
  };
  const { calls, hooks } = sink();
  const h = new HoldToTalk(() => new VoiceRecorder(d), () => hooks, 800);
  h.press();
  h.release();                    // cancel the pending start
  perm.resolve({ granted: true }); // OS prompt resolves afterwards
  await flush(); await flush();
  assert.equal(created, 0);        // cancel checked before createRecorder/setMode
  assert.equal(rec.recorded, false);
  assert.equal(calls.sent.length, 0);
  assert.deepEqual(modes, [false]); // only the cleanup mode reset ran
});

test('hold + real recorder: press ignored while prior stop unresolved; terminate + late stop sends nothing', async () => {
  const rec = new FakeNative();
  rec.prepareGate.resolve();
  const modes: boolean[] = [];
  const d: AudioDeps = {
    requestPermission: async () => ({ granted: true }),
    setMode: async m => { modes.push(m.allowsRecording); },
    createRecorder: () => rec,
  };
  const { calls, hooks } = sink();
  let t = Date.now();
  let makes = 0;
  const h = new HoldToTalk(() => { makes++; return new VoiceRecorder(d); }, () => hooks, 800, () => t);
  h.press();
  await flush();
  assert.equal(rec.recorded, true);
  const stopGate = deferred();
  rec.stopWait = stopGate.promise;
  t += 5000;
  h.release();                    // stopping; native stop() still in flight
  await flush();
  h.press();                      // ignored: teardown not complete
  await flush();
  assert.equal(makes, 1);
  h.terminate();
  stopGate.resolve();             // stale stop resolves after terminate
  await flush(); await flush();
  assert.equal(calls.sent.length, 0);
  assert.equal(makes, 1);
  // a fresh hold still works once teardown settled
  t += 5000;
  h.press();
  await flush();
  assert.equal(makes, 2);
  h.terminate();
  await flush(); await flush();
});

// ---------------------------------------------------------------- outboxsend

class FakeFs implements OutboxFs {
  documentDirectory = 'file:///docs/';
  files = new Set<string>();
  copyFails = false;
  partialDest = true;
  async makeDirectoryAsync() {}
  async copyAsync({ from, to }: { from: string; to: string }) {
    if (this.copyFails) { if (this.partialDest) this.files.add(to); throw new Error('copy_failed'); }
    this.files.add(to);
  }
  async deleteAsync(p: string) { for (const f of [...this.files]) if (f === p || f.startsWith(p.endsWith('/') ? p : p + '/')) this.files.delete(f); }
}

const item = (uri?: string): OutboxItem => ({
  client_id: 'abcdef1234567890', phone: '+27', type: 'image', uri, filename: 'p.jpg', mime: 'image/jpeg', created_at: new Date().toISOString(), attempts: 0,
});

test('enqueue: source copied to owned durable path before outbox write', async () => {
  const fs = new FakeFs();
  const written: OutboxItem[] = [];
  const out = await enqueueOutgoing(item('file:///cache/p.jpg'), { fs, alive: () => true, writeOutbox: async i => { written.push({ ...i }); } });
  const owned = 'file:///docs/outbox-media/abcdef1234567890.jpg';
  assert.equal(out.uri, owned);
  assert.equal(written[0].uri, owned);            // persisted row points at durable copy
  assert.ok(fs.files.has(owned));                 // restart/retry uploads the durable file
  assert.ok(!fs.files.has('file:///cache/p.jpg')); // source never touched
});

test('enqueue: rejected copy removes the partial dest and fails friendly', async () => {
  const fs = new FakeFs();
  fs.copyFails = true;
  const dest = 'file:///docs/outbox-media/abcdef1234567890.jpg';
  fs.files.add('file:///cache/p.jpg');
  await assert.rejects(
    enqueueOutgoing(item('file:///cache/p.jpg'), { fs, alive: () => true, writeOutbox: async () => {} }),
    (e: any) => e instanceof SendError && e.code === 'attach_failed');
  assert.ok(!fs.files.has(dest));               // partial dest cleaned
  assert.ok(fs.files.has('file:///cache/p.jpg')); // source preserved
});

test('enqueue: outbox write failure deletes the owned copy', async () => {
  const fs = new FakeFs();
  const dest = 'file:///docs/outbox-media/abcdef1234567890.jpg';
  await assert.rejects(
    enqueueOutgoing(item('file:///cache/p.jpg'), { fs, alive: () => true, writeOutbox: async () => { throw new Error('db'); } }),
    (e: any) => e instanceof SendError && e.code === 'queue_failed');
  assert.ok(!fs.files.has(dest));
});

test('enqueue: session ending after copy never queues and cleans the owned file', async () => {
  const fs = new FakeFs();
  const dest = 'file:///docs/outbox-media/abcdef1234567890.jpg';
  let wrote = false;
  await assert.rejects(
    enqueueOutgoing(item('file:///cache/p.jpg'), { fs, alive: () => false, writeOutbox: async () => { wrote = true; } }),
    (e: any) => e instanceof SendError && e.code === 'no_session');
  assert.equal(wrote, false);
  assert.ok(!fs.files.has(dest));
});

test('enqueue: a traversal client id cannot escape the owned directory', async () => {
  const fs = new FakeFs();
  for (const bad of ['../x', 'a/b', '..', '', 'a%2e%2e', 'a.b', 'a\\b']) {
    const badItem = item('file:///cache/p.jpg');
    badItem.client_id = bad;
    await assert.rejects(
      enqueueOutgoing(badItem, { fs, alive: () => true, writeOutbox: async () => {} }),
      (e: any) => e instanceof SendError && e.code === 'attach_failed');
  }
  assert.equal(fs.files.size, 0); // nothing copied, nothing deleted outside
});

// ---------------------------------------------------------------- quotesfeed

function feedRig(over: Partial<Parameters<typeof createQuotesFeed>[0]> = {}) {
  const calls = { shown: [] as string[][], cached: 0, errors: [] as string[], writes: 0, fenceChecks: 0 };
  const state = { live: true };
  const feed = createQuotesFeed<{ q: string }>({
    live: () => state.live,
    fetch: async () => [{ q: 'fresh' }],
    loadCache: async () => [{ q: 'cached' }],
    queueWrite: (isCurrent, action) => { calls.fenceChecks++; return Promise.resolve(isCurrent() ? (calls.writes++, action(), undefined) : undefined); },
    writeCache: async () => {},
    onQuotes: q => { calls.shown.push(q.map(x => x.q)); },
    onCached: () => { calls.cached++; },
    onError: m => { calls.errors.push(m); },
    ...over,
  });
  return { calls, state, feed };
}

test('quotes feed: normal pull shows data and writes cache through the fence', async () => {
  const { calls, feed } = feedRig();
  await feed.pull();
  assert.deepEqual(calls.shown, [['fresh']]);
  assert.equal(calls.writes, 1);
  await feed.restore();
  assert.equal(calls.cached, 1);
});

test('quotes feed: response resolving after logout never shows or writes', async () => {
  const gate = deferred();
  const { calls, state, feed } = feedRig({ fetch: () => gate.promise });
  const p = feed.pull();
  state.live = false;             // session ended while the request was in flight
  gate.resolve([{ q: 'stale' }]);
  await p;
  assert.equal(calls.shown.length, 0);
  assert.equal(calls.writes, 0);
  assert.equal(calls.errors.length, 0);
});

test('quotes feed: queued cache write re-checks the fence at the head of the queue', async () => {
  const writeGate = deferred();
  let queuedAction: (() => unknown) | null = null;
  let queuedCheck: (() => boolean) | null = null;
  const { calls, state, feed } = feedRig({
    queueWrite: (isCurrent, action) => {
      queuedCheck = isCurrent; queuedAction = action;
      return writeGate.promise.then(() => { calls.fenceChecks++; if (isCurrent()) { calls.writes++; action(); } });
    },
  });
  const p = feed.pull();
  await flush();                  // response applied; write parked behind the gate
  state.live = false;             // logout before the queued write runs
  writeGate.resolve();
  await p;
  assert.ok(queuedAction && queuedCheck);
  assert.equal(calls.writes, 0);
});

test('quotes feed: cache restores while a pull is in flight; resolves after pull gen bumped', async () => {
  const fetchGate = deferred();
  const { calls, feed } = feedRig({ fetch: () => fetchGate.promise });
  const p1 = feed.restore();      // kicks loadCache
  const p2 = feed.pull();         // bumps pull generation before cache resolves
  await p1;                       // restore must still apply (onCached merges via c=>c||q)
  assert.equal(calls.cached, 1);
  fetchGate.reject(new Error('offline'));
  await p2;
  assert.deepEqual(calls.shown, []); // offline pull shows nothing, cache already shown
});

test('quotes feed: cache resolving after logout is ignored', async () => {
  const cacheGate = deferred();
  const { calls, state, feed } = feedRig({ loadCache: () => cacheGate.promise });
  const p = feed.restore();
  state.live = false;
  cacheGate.resolve([{ q: 'stale' }]);
  await p;
  assert.equal(calls.cached, 0);
});

test('quotes feed: the newest pull wins over a stale in-flight one', async () => {
  const gates = [deferred(), deferred()];
  let i = 0;
  const { calls, feed } = feedRig({ fetch: () => gates[i++].promise });
  const p1 = feed.pull();
  const p2 = feed.pull();         // aborts/supersedes p1
  gates[0].resolve([{ q: 'old' }]);
  gates[1].resolve([{ q: 'new' }]);
  await Promise.all([p1, p2]);
  assert.deepEqual(calls.shown, [['new']]);
  assert.equal(calls.writes, 1);
});

// ---------------------------------------------------------------- request gate

test('request gate: abandoned redeem cannot adopt a session', () => {
  const gate = new RequestGate();
  const g = gate.next();          // redeem for token A in flight
  gate.bump();                    // token changed to B / effect re-ran
  assert.equal(gate.current(g), false);
  const g2 = gate.next();
  assert.equal(gate.current(g2), true);
  gate.invalidate();              // unmount
  assert.equal(gate.current(g2), false);
});
