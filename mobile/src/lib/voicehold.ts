// Cancellable hold-to-record controller, platform-independent for testing.
// Lifecycle rules:
//  - a press is ignored while a hold is active OR a previous teardown/send is still
//    pending, so a cancelled flow can never leave a delayed permission prompt or a
//    second recorder racing the first;
//  - release/terminate while start() is pending cancels the eventual recorder;
//  - 'stopping' lasts until stop() AND the send complete, and a generation ticket
//    re-checked after every await means a terminate can invalidate the send and any
//    stale completion can neither send nor clear UI drawn by a newer hold.
export interface VoiceSession {
  startedAt: number;
  onLevel?: (level: number) => void;
  start(): Promise<void>;
  cancel(): void | Promise<unknown>;
  stop(): Promise<{ uri: string; mime: string } | null>;
}

export interface HoldHooks {
  onRecording?(session: VoiceSession): void;
  onIdle?(): void;
  onSend(uri: string, mime: string): void | Promise<unknown>;
  onError(message: string): void;
}

export class HoldToTalk {
  private state: 'idle' | 'starting' | 'recording' | 'stopping' = 'idle';
  private session: VoiceSession | null = null;
  private pending: Promise<unknown> | null = null;
  private ticket = 0;
  private make: () => VoiceSession;
  private hooks: () => HoldHooks;
  private minMs: number;
  private now: () => number;

  constructor(make: () => VoiceSession, hooks: () => HoldHooks, minMs = 800, now: () => number = Date.now) {
    this.make = make;
    this.hooks = hooks;
    this.minMs = minMs;
    this.now = now;
  }

  get active() { return this.state !== 'idle' || this.pending !== null; }

  press() {
    if (this.state !== 'idle' || this.pending) return;
    this.state = 'starting';
    const session = this.make();
    this.session = session;
    this.track(session.start().then(() => {
      if (this.session !== session) { this.trackCancel(session); return; }
      this.state = 'recording';
      this.hooks().onRecording?.(session);
    }, () => {
      if (this.session !== session) return;
      this.state = 'idle';
      this.session = null;
      this.hooks().onError('Microphone access is needed for voice notes.');
      this.idle();
    }));
  }

  release(slideCancel = false) {
    const session = this.session;
    if (!session || this.state === 'idle' || this.state === 'stopping') return;
    const t = ++this.ticket;
    if (this.state === 'starting') {
      // Released before the recorder came up: cancel the eventual start, silently.
      this.state = 'idle';
      this.session = null;
      this.trackCancel(session);
      this.idle();
      return;
    }
    if (slideCancel || this.now() - session.startedAt < this.minMs) {
      this.state = 'idle';
      this.session = null;
      this.trackCancel(session);
      if (!slideCancel) this.hooks().onError('Hold the mic to record a voice note.');
      this.idle();
      return;
    }
    this.state = 'stopping';
    this.session = null;
    this.track((async () => {
      let out: { uri: string; mime: string } | null = null;
      try {
        out = await session.stop();
      } catch {
        out = null;
      }
      if (t !== this.ticket) return;
      if (out === null) this.hooks().onError('Could not save the voice note. Please try again.');
      if (out?.uri) {
        try {
          await this.hooks().onSend(out.uri, out.mime);
        } catch (e) {
          this.hooks().onError(e instanceof Error ? e.message : 'Could not send the voice note.');
        }
      }
      // A terminate during onSend must not let this stale completion clear newer UI.
      if (t !== this.ticket) return;
      this.state = 'idle';
      this.idle();
    })());
  }

  // Terminate (gesture stolen, unmount, background): cancel without sending, and
  // invalidate any in-flight stop/send so its completion can do neither.
  terminate() {
    ++this.ticket;
    const session = this.session;
    const was = this.state;
    this.state = 'idle';
    this.session = null;
    if (session) this.trackCancel(session);
    if (was !== 'idle') this.idle();
  }

  private track(p: Promise<unknown>) {
    const q = p.then(() => {}, () => {});
    this.pending = q;
    void q.then(() => { if (this.pending === q) this.pending = null; });
  }
  private trackCancel(session: VoiceSession) {
    this.track(Promise.resolve().then(() => session.cancel()));
  }
  private idle() { this.hooks().onIdle?.(); }
}
