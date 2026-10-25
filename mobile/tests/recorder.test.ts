import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceRecorder, type AudioDeps, type NativeRecorder } from '../src/lib/voicerecorder.ts';
import { adoptOutboxFile, clearOutboxMedia, deleteOwnedOutboxFile, isOwnedOutboxUri } from '../src/lib/outboxstore.ts';
import { createExternalOpener } from '../src/lib/external.ts';

const flush = () => new Promise<void>(r => setTimeout(r, 0));

function deferred() {
  let resolve!: (v?: unknown) => void, reject!: (e?: unknown) => void;
  const promise = new Promise<any>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class FakeNative implements NativeRecorder {
  recorded = false; stops = 0; releases = 0; uri: string | null = 'file:///rec.m4a';
  prepareGate = deferred(); stopWait: Promise<unknown> | null = null; failStop = false;
  async prepareToRecordAsync() { await this.prepareGate.promise; }
  record() { this.recorded = true; }
  async stop() { if (this.stopWait) await this.stopWait; this.stops++; if (this.failStop) throw new Error('stop_failed'); }
  release() { this.releases++; }
  getStatus() { return { metering: -20 }; }
}

function audioDeps(rec: FakeNative, permGate?: ReturnType<typeof deferred>) {
  const modes: { allowsRecording: boolean }[] = [];
  const d: AudioDeps = {
    requestPermission: async () => { if (permGate) await permGate.promise; return { granted: true }; },
    setMode: async m => { modes.push(m); },
    createRecorder: () => rec,
  };
  return { d, modes };
}

test('recorder: cancel while permission pending — recorder never created, mode still reset', async () => {
  const rec = new FakeNative();
  const perm = deferred();
  const { d, modes } = audioDeps(rec, perm);
  let created = 0;
  const d2: AudioDeps = { ...d, createRecorder: () => { created++; return rec; } };
  const r = new VoiceRecorder(d2);
  const started = r.start();
  const cancelled = r.cancel();
  perm.resolve({ granted: true });
  await started;
  await cancelled;
  assert.equal(created, 0); // cancel is checked before createRecorder/setMode
  assert.equal(rec.recorded, false);
  assert.deepEqual(modes.map(m => m.allowsRecording), [false]);
});

test('recorder: cancel while prepare pending stops + releases the native recorder', async () => {
  const rec = new FakeNative();
  const { d, modes } = audioDeps(rec);
  const r = new VoiceRecorder(d);
  const started = r.start();
  await flush(); // permission + createRecorder + setMode done, inside prepare await
  const cancelled = r.cancel();
  rec.prepareGate.resolve();
  await started;
  await cancelled;
  assert.equal(rec.recorded, false);
  assert.equal(rec.stops, 1);
  assert.equal(rec.releases, 1);
  assert.equal(modes.at(-1)?.allowsRecording, false);
});

test('recorder: rejected native stop returns null, still releases resources', async () => {
  const rec = new FakeNative();
  rec.failStop = true;
  rec.prepareGate.resolve();
  const { d, modes } = audioDeps(rec);
  const r = new VoiceRecorder(d);
  await r.start();
  assert.equal(rec.recorded, true);
  const out = await r.stop();
  assert.equal(out, null);
  assert.equal(rec.releases, 1);
  assert.equal(modes.at(-1)?.allowsRecording, false);
});

test('recorder: clean stop returns the file once and is idempotent', async () => {
  const rec = new FakeNative();
  rec.prepareGate.resolve();
  const { d } = audioDeps(rec);
  const r = new VoiceRecorder(d);
  await r.start();
  const out = await r.stop();
  assert.equal(out?.uri, 'file:///rec.m4a');
  const again = await r.stop();
  assert.equal(again, null);
  assert.equal(rec.stops, 1);
});

class FakeFs {
  documentDirectory = 'file:///docs/';
  files = new Set<string>();
  copies: [string, string][] = [];
  copyWait: Promise<unknown> | null = null;
  async makeDirectoryAsync() {}
  async readDirectoryAsync(dir: string) { return [...this.files].filter(f => f.startsWith(dir)).map(f => f.slice(dir.length)); }
  async copyAsync({ from, to }: { from: string; to: string }) { if (this.copyWait) await this.copyWait; this.copies.push([from, to]); this.files.add(to); }
  async deleteAsync(p: string) { for (const f of [...this.files]) if (f === p || f.startsWith(p.endsWith('/') ? p : p + '/')) this.files.delete(f); }
}

test('outboxstore: source is copied into owned durable path; only owned paths delete', async () => {
  const fs = new FakeFs();
  const owned = await adoptOutboxFile(fs, 'file:///cache/photo.jpg', 'abc123');
  assert.equal(owned, 'file:///docs/outbox-media/abc123.jpg');
  assert.deepEqual(fs.copies, [['file:///cache/photo.jpg', owned]]);
  assert.ok(isOwnedOutboxUri(fs, owned));
  assert.ok(!isOwnedOutboxUri(fs, 'file:///cache/photo.jpg'));
  assert.ok(!isOwnedOutboxUri(fs, 'file:///docs/outbox-media/../other.db'));
  assert.ok(!isOwnedOutboxUri(fs, undefined));
  fs.files.add('file:///cache/photo.jpg');
  await deleteOwnedOutboxFile(fs, 'file:///cache/photo.jpg'); // source: never deleted
  assert.ok(fs.files.has('file:///cache/photo.jpg'));
  await deleteOwnedOutboxFile(fs, owned);
  assert.ok(!fs.files.has(owned));
});

test('outboxstore: wipe clears only the owned directory', async () => {
  const fs = new FakeFs();
  const owned = await adoptOutboxFile(fs, 'file:///cache/a.m4a', 'c1');
  fs.files.add('file:///docs/other.db');
  await clearOutboxMedia(fs);
  assert.ok(!fs.files.has(owned));
  assert.ok(fs.files.has('file:///docs/other.db'));
});

test('external opener: only sanitized HTTPS reaches the browser, no headers', async () => {
  const opened: string[] = [];
  const open = createExternalOpener(async (url: string) => { opened.push(url); });
  await open('https://pay.example.test/pay');
  await open('http://pay.example.test/pay');
  await open('file:///etc/passwd');
  await open('javascript:alert(1)');
  await open('https://user:pw@pay.example.test/');
  assert.deepEqual(opened, ['https://pay.example.test/pay']);
});
