import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../src/lib/session.ts';
import { restoreSession } from '../src/lib/boot.ts';
import { HoldToTalk, type HoldHooks, type VoiceSession } from '../src/lib/voicehold.ts';

const flush = () => new Promise<void>(r => setTimeout(r, 0));

// Controllable in-memory token store: pauseNext() defers the next store op.
class MemStore {
  data = new Map<string, string>();
  private gates: Promise<void>[] = [];
  pauseNext() {
    let release!: () => void;
    this.gates.push(new Promise<void>(r => { release = r; }));
    return release;
  }
  private async wait() { const g = this.gates.shift(); if (g) await g; }
  async getItem(k: string) { await this.wait(); return this.data.get(k) ?? null; }
  async setItem(k: string, v: string) { await this.wait(); this.data.set(k, v); }
  async deleteItem(k: string) { await this.wait(); this.data.delete(k); }
}

test('auth: a slow set() cannot resurrect a cleared session', async () => {
  const store = new MemStore();
  const auth = createAuth(store);
  const release = store.pauseNext();
  auth.set('tok-a');            // setItem lands slowly
  auth.clear();                 // delete must be ordered after the set
  release();
  await flush(); await flush();
  assert.equal(auth.token, null);
  assert.equal(store.data.has('hds.token'), false);
});

test('auth: in-flight load() does not overwrite a newer set()', async () => {
  const store = new MemStore();
  store.data.set('hds.token', 'old');
  const auth = createAuth(store);
  const release = store.pauseNext();
  const p = auth.load();
  auth.set('new');
  release();
  const got = await p;
  await flush();
  assert.equal(auth.token, 'new');
  assert.equal(got, 'new');
  await flush();
  assert.equal(store.data.get('hds.token'), 'new');
});

test('auth: in-flight load() does not resurrect after clear()', async () => {
  const store = new MemStore();
  store.data.set('hds.token', 'old');
  const auth = createAuth(store);
  const release = store.pauseNext();
  const p = auth.load();
  auth.clear();
  release();
  await p;
  await flush(); await flush();
  assert.equal(auth.token, null);
  assert.equal(store.data.has('hds.token'), false);
});

interface User { id: string }
function bootRig(over: Partial<Parameters<typeof restoreSession<User>>[0]> = {}) {
  const state = { generation: 0, user: null as User | null, boots: 0 };
  const auth = {
    token: null as string | null,
    async load() { return auth.token; },
  };
  const deps = {
    auth,
    cachedUser: async (_t: string) => null as User | null,
    fetchMe: async () => ({ id: 'fresh' }) as User,
    cacheUser: async () => {},
    ...over,
  };
  const run = () => {
    const epoch = ++state.generation;
    return restoreSession(deps, () => state.generation === epoch, u => { state.user = u; }, () => { state.boots++; });
  };
  return { state, auth, deps, run };
}

test('boot: fresh install with no token still finishes boot (login screen)', async () => {
  const { state, run } = bootRig();
  await run();
  assert.equal(state.boots, 1);
  assert.equal(state.user, null);
});

test('boot: storage failure still finishes boot', async () => {
  const rig = bootRig();
  (rig.auth as any).load = async () => { throw new Error('securestore down'); };
  await rig.run();
  assert.equal(rig.state.boots, 1);
  assert.equal(rig.state.user, null);
});

test('boot: offline session keeps cached identity', async () => {
  const rig = bootRig({
    cachedUser: async () => ({ id: 'cached' }),
    fetchMe: async () => { throw new Error('offline'); },
  });
  rig.auth.token = 'tok';
  await rig.run();
  assert.equal(rig.state.user?.id, 'cached');
  assert.ok(rig.state.boots >= 1);
});

test('boot: stale boot ignored after logout (generation bumped)', async () => {
  let resolveMe!: (u: User) => void;
  const rig = bootRig({ fetchMe: () => new Promise<User>(r => { resolveMe = r; }) });
  rig.auth.token = 'tok';
  const p = rig.run();
  await flush();
  ++rig.state.generation; // logout
  resolveMe({ id: 'fresh' });
  await p;
  assert.equal(rig.state.user, null);
  assert.equal(rig.state.boots, 0);
});

test('boot: stale boot ignored after token replacement', async () => {
  let resolveMe!: (u: User) => void;
  const rig = bootRig({ fetchMe: () => new Promise<User>(r => { resolveMe = r; }) });
  rig.auth.token = 'tok-a';
  const p = rig.run();
  await flush();
  rig.auth.token = 'tok-b'; // newer session landed before /me resolved
  resolveMe({ id: 'fresh' });
  await p;
  assert.equal(rig.state.user, null);
});

class FakeSession implements VoiceSession {
  startedAt = 0;
  cancels = 0;
  stops = 0;
  startFails = false;
  private gate: Promise<void> | null = null;
  holdStart() {
    let release!: () => void;
    this.gate = new Promise<void>(r => { release = r; });
    return release;
  }
  async start() {
    if (this.gate) await this.gate;
    if (this.startFails) throw new Error('mic_denied');
    this.startedAt = now.v;
  }
  cancel() { this.cancels++; }
  async stop() { this.stops++; return { uri: 'file:///v.m4a', mime: 'audio/m4a' }; }
}

const now = { v: 1000 };
function holdRig(session: FakeSession, hooks: () => HoldHooks) {
  return new HoldToTalk(() => session, hooks, 800, () => now.v);
}
function hooksSink() {
  const calls = { sent: [] as string[], errors: [] as string[], recordings: 0, idles: 0 };
  const hooks: HoldHooks = {
    onRecording: () => { calls.recordings++; },
    onIdle: () => { calls.idles++; },
    onSend: uri => { calls.sent.push(uri); },
    onError: m => { calls.errors.push(m); },
  };
  return { calls, hooks };
}

test('hold: release while permission pending cancels the eventual start', async () => {
  const s = new FakeSession();
  const releaseStart = s.holdStart();
  const { calls, hooks } = hooksSink();
  const h = holdRig(s, () => hooks);
  h.press();
  h.release();
  releaseStart();
  await flush();
  assert.ok(s.cancels >= 1); // cancel at release + cancel when the stale start resolves
  assert.equal(s.stops, 0);
  assert.equal(calls.sent.length, 0);
});

test('hold: terminate while pending cancels the eventual start', async () => {
  const s = new FakeSession();
  const releaseStart = s.holdStart();
  const { calls, hooks } = hooksSink();
  const h = holdRig(s, () => hooks);
  h.press();
  h.terminate();
  releaseStart();
  await flush();
  assert.ok(s.cancels >= 1);
  assert.equal(calls.sent.length, 0);
});

test('hold: terminate while recording cancels without sending', async () => {
  const s = new FakeSession();
  const { calls, hooks } = hooksSink();
  const h = holdRig(s, () => hooks);
  h.press();
  await flush();
  now.v += 5000;
  h.terminate();
  await flush();
  assert.equal(s.cancels, 1);
  assert.equal(s.stops, 0);
  assert.equal(calls.sent.length, 0);
});

test('hold: short hold under 800ms cancels and surfaces a hint', async () => {
  const s = new FakeSession();
  const { calls, hooks } = hooksSink();
  const h = holdRig(s, () => hooks);
  h.press();
  await flush();
  now.v += 400;
  h.release();
  await flush();
  assert.equal(s.cancels, 1);
  assert.equal(s.stops, 0);
  assert.equal(calls.sent.length, 0);
  assert.ok(calls.errors.some(m => /hold the mic/i.test(m)));
});

test('hold: slide cancel cancels silently', async () => {
  const s = new FakeSession();
  const { calls, hooks } = hooksSink();
  const h = holdRig(s, () => hooks);
  h.press();
  await flush();
  now.v += 5000;
  h.release(true);
  await flush();
  assert.equal(s.cancels, 1);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.errors.length, 0);
});

test('hold: normal release sends exactly once with the latest hooks', async () => {
  const s = new FakeSession();
  const first = hooksSink();
  const second = hooksSink();
  let current = first.hooks;
  const h = holdRig(s, () => current);
  h.press();
  await flush();
  current = second.hooks; // reply target changed mid-hold
  now.v += 2000;
  h.release();
  await flush();
  h.release(); // second release must be a no-op
  await flush();
  assert.equal(s.stops, 1);
  assert.equal(first.calls.sent.length, 0);
  assert.deepEqual(second.calls.sent, ['file:///v.m4a']);
});

test('hold: terminate during a pending stop invalidates the late send and newer UI is untouched', async () => {
  const s = new FakeSession();
  let resolveStop!: (v: { uri: string; mime: string }) => void;
  const gate = new Promise<{ uri: string; mime: string }>(r => { resolveStop = r; });
  const origStop = s.stop.bind(s);
  s.stop = () => { void origStop; s.stops++; return gate; };
  const { calls, hooks } = hooksSink();
  const h = holdRig(s, () => hooks);
  h.press();
  await flush();
  now.v += 5000;
  h.release();            // enters stopping; stop() in flight
  const idlesBefore = calls.idles;
  h.terminate();          // invalidate the in-flight stop
  resolveStop({ uri: 'file:///late.m4a', mime: 'audio/m4a' });
  await flush(); await flush();
  assert.equal(s.stops, 1);
  assert.equal(calls.sent.length, 0);              // late stop resolves but never sends
  assert.equal(calls.idles, idlesBefore + 1);      // terminate cleared UI once; stale completion adds nothing
});

test('hold: a rejecting cancel does not produce an unhandled rejection', async () => {
  const s = new FakeSession();
  s.cancel = () => Promise.reject(new Error('stop_failed'));
  const { calls, hooks } = hooksSink();
  const h = holdRig(s, () => hooks);
  h.press();
  await flush();
  now.v += 5000;
  h.terminate();
  await flush(); await flush();
  assert.equal(calls.sent.length, 0);
});

test('hold: next press works after teardown completes', async () => {
  const first = new FakeSession();
  const second = new FakeSession();
  const sessions = [first, second];
  const { calls, hooks } = hooksSink();
  const h = new HoldToTalk(() => sessions.shift()!, () => hooks, 800, () => now.v);
  h.press();
  await flush();
  now.v += 400;
  h.release(); // short hold → cancels
  await flush();
  h.press();
  await flush();
  assert.equal(second.startedAt > 0 || (second as any).started !== undefined, true);
  now.v += 5000;
  h.release();
  await flush();
  assert.deepEqual(calls.sent, ['file:///v.m4a']);
});

test('hold: press is ignored while a previous stop is still unresolved', async () => {
  const s1 = new FakeSession();
  const s2 = new FakeSession();
  const sessions = [s1, s2];
  let resolveStop!: () => void;
  const gate = new Promise<{ uri: string; mime: string } | null>(r => { resolveStop = () => r({ uri: 'file:///v.m4a', mime: 'audio/m4a' }); });
  s1.stop = () => gate;
  const { calls, hooks } = hooksSink();
  const h = new HoldToTalk(() => sessions.shift()!, () => hooks, 800, () => now.v);
  h.press();
  await flush();
  now.v += 5000;
  h.release();            // stopping; s1.stop() pending
  await flush();
  h.press();              // must be ignored: prior stop not finished
  await flush();
  assert.equal(s2.startedAt, 0);
  resolveStop();
  await flush(); await flush();
  h.press();              // now allowed
  await flush();
  assert.equal(s2.startedAt > 0, true);
  assert.deepEqual(calls.sent, ['file:///v.m4a']);
});

test('hold: start failure surfaces an error and resets', async () => {
  const s = new FakeSession();
  s.startFails = true;
  const { calls, hooks } = hooksSink();
  const h = holdRig(s, () => hooks);
  h.press();
  await flush();
  assert.ok(calls.errors.some(m => /microphone/i.test(m)));
  assert.equal(h.active, false);
});
