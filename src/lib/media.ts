// Client-side media helpers: photo compression (saves data on SA networks) and a WAV voice recorder.
// WAV (16 kHz mono PCM) is used for voice notes because William's transcriber (Gemini) accepts it on
// every browser, unlike Chrome's webm/opus.

export async function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<{ blob: Blob; mime: string }> {
  if (!/^image\/(jpeg|png|webp|heic|heif)/.test(file.type) || file.size < 250_000) return { blob: file, mime: file.type || 'image/jpeg' };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', quality));
    return blob.size < file.size ? { blob, mime: 'image/jpeg' } : { blob: file, mime: file.type };
  } catch {
    return { blob: file, mime: file.type || 'image/jpeg' };
  }
}

export class VoiceRecorder {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: ScriptProcessorNode;
  private chunks: Float32Array[] = [];
  private rate = 16000;
  startedAt = 0;
  onLevel?: (v: number) => void;

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(d));
      let peak = 0; for (let i = 0; i < d.length; i += 64) peak = Math.max(peak, Math.abs(d[i]));
      this.onLevel?.(peak);
    };
    src.connect(this.node); this.node.connect(this.ctx.destination);
    this.startedAt = Date.now();
  }

  cancel() { this.cleanup(); this.chunks = []; }

  async stop(): Promise<Blob> {
    const inRate = this.ctx?.sampleRate || 48000;
    this.cleanup();
    const len = this.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(len);
    let o = 0; for (const c of this.chunks) { all.set(c, o); o += c.length; }
    // downsample (box filter) to 16 kHz
    const ratio = inRate / this.rate;
    const outLen = Math.floor(all.length / ratio);
    const pcm = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const s = Math.floor(i * ratio), e = Math.min(all.length, Math.floor((i + 1) * ratio));
      let sum = 0; for (let j = s; j < e; j++) sum += all[j];
      const v = Math.max(-1, Math.min(1, sum / Math.max(1, e - s)));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return wav(pcm, this.rate);
  }

  private cleanup() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close().catch(() => {});
    this.node = undefined; this.stream = undefined; this.ctx = undefined;
  }
}

function wav(pcm: Int16Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}
