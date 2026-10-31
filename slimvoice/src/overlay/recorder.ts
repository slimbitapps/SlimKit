/**
 * Mikrofon → 16 kHz mono → Sprachabschnitte.
 * Eine einfache, robuste Sprechpausen-Erkennung (Lautstärke gegen mitlaufenden Grundrauschpegel) schneidet die
 * Aufnahme an Pausen. Stille wird gar nicht erst verschickt – das spart Kosten und verhindert,
 * dass die Spracherkennung in Stille „Untertitel des ZDF“ hört.
 */

export interface RecorderOptions {
  micId: string;
  pauseMs: number;
  /** 0 … 100 */
  sensitivity: number;
  processing: boolean;
  onSegment: (idx: number, pcm: Int16Array) => void;
  onLevel: (level: number, speaking: boolean) => void;
}

const RATE = 16000;
const FRAME = 1024; // 64 ms
const FRAME_MS = (FRAME / RATE) * 1000;
const PREROLL_FRAMES = 5; // ~320 ms vor dem ersten lauten Moment mitnehmen
const KEEP_TAIL_FRAMES = 3; // ~190 ms Stille am Ende behalten
const MIN_VOICED_MS = 180;
const MAX_SEGMENT_MS = 28000;

export class Recorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private proc: ScriptProcessorNode | null = null;
  private opts: RecorderOptions;
  private idx = 0;
  private noise = 0.004;
  private preroll: Float32Array[] = [];
  private seg: Float32Array[] | null = null;
  private voicedFrames = 0;
  private silentFrames = 0;
  private loudRun = 0;
  private stopped = false;

  constructor(opts: RecorderOptions) {
    this.opts = opts;
  }

  async start() {
    const audio: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: this.opts.processing,
      noiseSuppression: this.opts.processing,
      autoGainControl: this.opts.processing,
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: this.opts.micId ? { ...audio, deviceId: { exact: this.opts.micId } } : audio });
    } catch (e) {
      // gewähltes Mikrofon nicht mehr da → Standardmikrofon
      if (!this.opts.micId) throw e;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    }
    this.ctx = new AudioContext({ sampleRate: RATE });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(FRAME, 1, 1);
    this.proc.onaudioprocess = (e) => {
      if (!this.stopped) this.frame(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    src.connect(this.proc);
    this.proc.connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Aufnahme beenden; der laufende Abschnitt wird noch verschickt */
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.seg) this.endSegment();
    await this.close();
  }

  async cancel() {
    this.stopped = true;
    this.seg = null;
    await this.close();
  }

  private async close() {
    try {
      this.proc?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      await this.ctx?.close();
    } catch {
      /* egal */
    }
    this.proc = null;
    this.stream = null;
    this.ctx = null;
  }

  private threshold() {
    const s = Math.min(100, Math.max(0, this.opts.sensitivity)) / 100;
    const factor = 4 - s * 2.6; // empfindlicher = näher am Grundrauschen
    const floor = 0.014 - s * 0.011;
    return Math.max(this.noise * factor, floor);
  }

  private frame(f: Float32Array) {
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    const rms = Math.sqrt(sum / f.length);
    const th = this.threshold();
    const loud = rms > th;

    // Grundrauschen nur in ruhigen Momenten nachführen
    if (!this.seg && !loud) this.noise = this.noise * 0.95 + rms * 0.05;
    else if (!this.seg) this.noise = this.noise * 0.998 + rms * 0.002;

    this.opts.onLevel(Math.min(1, rms / Math.max(th * 3, 0.03)), !!this.seg);

    if (!this.seg) {
      this.preroll.push(f);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (this.loudRun >= 2) {
        this.seg = [...this.preroll];
        this.preroll = [];
        this.voicedFrames = 2;
        this.silentFrames = 0;
      }
      return;
    }

    this.seg.push(f);
    if (loud) {
      this.voicedFrames++;
      this.silentFrames = 0;
    } else this.silentFrames++;

    const lenMs = this.seg.length * FRAME_MS;
    const pauseReached = this.silentFrames * FRAME_MS >= this.opts.pauseMs;
    // sehr lange ohne Pause: an einer leiseren Stelle schneiden
    const tooLong = lenMs >= MAX_SEGMENT_MS && (rms < th * 1.5 || lenMs >= MAX_SEGMENT_MS + 4000);
    if (pauseReached || tooLong) this.endSegment();
  }

  private endSegment() {
    const seg = this.seg;
    this.seg = null;
    this.loudRun = 0;
    if (!seg) return;
    const drop = Math.max(0, this.silentFrames - KEEP_TAIL_FRAMES);
    const frames = drop > 0 ? seg.slice(0, seg.length - drop) : seg;
    this.silentFrames = 0;
    if (this.voicedFrames * FRAME_MS < MIN_VOICED_MS) return;
    const pcm = new Int16Array(frames.length * FRAME);
    let o = 0;
    for (const fr of frames) {
      for (let i = 0; i < fr.length; i++) {
        const v = Math.max(-1, Math.min(1, fr[i]));
        pcm[o++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
    }
    this.opts.onSegment(this.idx++, pcm);
  }
}

/** Kurze Töne für Start/Ende */
export function beep(kind: 'start' | 'stop' | 'error') {
  try {
    const ctx = new AudioContext();
    const notes = kind === 'start' ? [660, 880] : kind === 'stop' ? [880, 660] : [330, 260];
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.08, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.085);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.09);
    });
    setTimeout(() => ctx.close(), 400);
  } catch {
    /* egal */
  }
}
