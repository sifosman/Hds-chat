// VoiceRecorder lives in its own module, free of Expo/RN imports, so the hold and
// teardown lifecycle is exercisable under plain node tests with fake audio deps.
export interface NativeRecorder {
  prepareToRecordAsync(): Promise<unknown>;
  record(): void;
  stop(): Promise<unknown>;
  release?(): unknown;
  uri: string | null;
  getStatus(): { metering?: number };
}
export interface AudioDeps {
  requestPermission(): Promise<{ granted: boolean }>;
  setMode(mode: { allowsRecording: boolean; playsInSilentMode?: boolean }): Promise<unknown>;
  createRecorder(): NativeRecorder;
}

export class VoiceRecorder {
  private rec: NativeRecorder | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private starting: Promise<void> | null = null;
  private finishing: Promise<string | null> | null = null;
  startedAt = 0;
  onLevel?: (v: number) => void;

  private audio: AudioDeps;

  constructor(audio: AudioDeps) { this.audio = audio; }

  // Every await is fenced: a cancel() landing mid-start still tears the native
  // recorder down via finish() instead of memoizing an early "no recorder" result.
  async start() {
    const d = this.audio;
    const job = (async () => {
      const perm = await d.requestPermission();
      if (!perm.granted) throw new Error('mic_denied');
      if (this.finishing) return; // cancelled while the OS permission prompt was up
      const rec = d.createRecorder();
      this.rec = rec;
      try {
        await d.setMode({ allowsRecording: true, playsInSilentMode: true });
        if (this.finishing) return;
        await rec.prepareToRecordAsync();
        if (this.finishing) return;
        rec.record();
        if (this.finishing) return;
      } catch (e) {
        // Startup failure must finish teardown before rejecting so a following
        // press cannot race a recorder/audio mode that is still being released.
        if (!this.finishing) {
          try { await rec.stop(); } catch { /* may not have started */ }
          try { rec.release?.(); } catch { /* best effort */ }
          this.rec = null;
          await d.setMode({ allowsRecording: false }).catch(() => {});
        }
        throw e;
      }
      this.startedAt = Date.now();
      this.meterTimer = setInterval(() => {
        const db = this.rec?.getStatus().metering;
        if (typeof db === 'number' && this.onLevel) this.onLevel(Math.max(0, Math.min(1, 1 + db / 50)));
      }, 200);
    })();
    this.starting = job;
    try { await job; } finally { this.starting = null; }
  }

  // One shared teardown: wait out any in-flight start, stop + release the native
  // recorder and reset the audio mode exactly once, however cancel()/stop() race.
  private finish(): Promise<string | null> {
    return this.finishing ||= (async () => {
      if (this.starting) await this.starting.catch(() => {});
      if (this.meterTimer) { clearInterval(this.meterTimer); this.meterTimer = null; }
      const rec = this.rec;
      this.rec = null;
      let uri: string | null = null;
      if (rec) {
        try { await rec.stop(); uri = rec.uri; } catch { uri = null; }
        try { rec.release?.(); } catch { /* best effort */ }
      }
      await this.audio.setMode({ allowsRecording: false }).catch(() => {});
      return uri;
    })();
  }

  async cancel() {
    await this.finish();
  }

  // A rejected native stop is a failed recording, never a silently "ok" file, and
  // the file is yielded at most once even if stop()/cancel() race.
  private delivered = false;
  async stop(): Promise<{ uri: string; mime: string } | null> {
    const uri = await this.finish();
    if (!uri || this.delivered) return null;
    this.delivered = true;
    return { uri, mime: 'audio/m4a' };
  }
}
