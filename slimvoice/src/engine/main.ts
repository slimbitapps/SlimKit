/**
 * Lokale Spracherkennung (Whisper) – läuft in einem unsichtbaren Fenster.
 * Das Modell wird nur auf Wunsch heruntergeladen und danach im App-Cache gehalten (offline nutzbar).
 * Grafikkarte (WebGPU) wenn möglich, sonst Prozessor (WebAssembly, mehrere Kerne).
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

type Device = 'webgpu' | 'wasm';
interface Cmd {
  id: number;
  cmd: 'status' | 'load' | 'transcribe' | 'delete' | 'unload';
  model?: string;
  device?: 'auto' | 'gpu' | 'cpu';
  pcm?: ArrayBuffer;
  language?: string;
}

// ONNX-Laufzeit aus der App selbst laden, nicht aus dem Internet
const ort = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (ort.wasm) {
  ort.wasm.wasmPaths = {
    mjs: new URL('./ort/ort-wasm-simd-threaded.asyncify.mjs', location.href).href,
    wasm: new URL('./ort/ort-wasm-simd-threaded.asyncify.wasm', location.href).href,
  };
  ort.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)) : 1;
}
env.allowLocalModels = false;
env.useBrowserCache = true;

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loaded = { model: '', device: '' as Device | '' };
let loading: Promise<void> | null = null;

const reply = (id: number, result: unknown) => window.api.call('engine:reply', id, result);
const event = (ev: Record<string, unknown>) => window.api.call('engine:event', ev);

async function hasGpu() {
  try {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    return !!(await nav.gpu?.requestAdapter());
  } catch {
    return false;
  }
}

/** Welche Dateien eines Modells liegen schon im Cache (und wie groß)? */
async function cached() {
  const out: Record<string, number> = {};
  try {
    const cache = await caches.open(env.cacheKey);
    for (const req of await cache.keys()) {
      const m = /huggingface\.co\/(onnx-community\/[^/]+)\//.exec(req.url);
      if (!m || !/\.onnx(_data)?$/.test(req.url)) continue;
      const res = await cache.match(req);
      const len = Number(res?.headers.get('content-length') || 0);
      out[m[1]] = (out[m[1]] || 0) + (len || 1);
    }
  } catch {
    /* kein Cache */
  }
  return out;
}

async function load(model: string, pref: 'auto' | 'gpu' | 'cpu' = 'auto') {
  const gpu = pref !== 'cpu' && (await hasGpu());
  const device: Device = gpu ? 'webgpu' : 'wasm';
  if (asr && loaded.model === model && loaded.device === device) return;
  if (loading) await loading;
  if (asr && loaded.model === model && loaded.device === device) return;
  loading = (async () => {
    await unload();
    event({ type: 'loading', model, device });
    const progress_callback = (p: { status: string; progress?: number; loaded?: number; total?: number }) => {
      if (p.status === 'progress_total') event({ type: 'progress', model, progress: p.progress ?? 0, loaded: p.loaded ?? 0, total: p.total ?? 0 });
    };
    const tryLoad = (d: Device) =>
      pipeline('automatic-speech-recognition', model, {
        device: d,
        // Grafikkarte: Encoder in halber Genauigkeit, Decoder 4-Bit · Prozessor: 8-Bit (klein und schnell)
        dtype: d === 'webgpu' ? { encoder_model: 'fp16', decoder_model_merged: 'q4' } : 'q8',
        progress_callback,
      } as never) as Promise<AutomaticSpeechRecognitionPipeline>;
    let used = device;
    try {
      asr = await tryLoad(device);
    } catch (e) {
      if (device !== 'webgpu') throw e;
      used = 'wasm'; // Grafikkarte macht Probleme → Prozessor
      asr = await tryLoad('wasm');
    }
    loaded = { model, device: used };
    event({ type: 'ready', model, device: used });
  })();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

async function unload() {
  const a = asr;
  asr = null;
  loaded = { model: '', device: '' };
  try {
    await a?.dispose();
  } catch {
    /* egal */
  }
}

async function remove(model: string) {
  if (loaded.model === model) await unload();
  const cache = await caches.open(env.cacheKey);
  for (const req of await cache.keys()) if (req.url.includes(`/${model}/`)) await cache.delete(req);
}

let queue = Promise.resolve();
function transcribe(c: Cmd) {
  // nacheinander – das Modell kann nur eine Sache gleichzeitig
  const job = queue.then(async () => {
    await load(c.model!, c.device);
    const i16 = new Int16Array(c.pcm!);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const t0 = performance.now();
    const out = (await asr!(f32, {
      ...(c.language && c.language !== 'auto' ? { language: c.language } : {}),
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    } as never)) as { text: string } | { text: string }[];
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim();
    return { text, ms: Math.round(performance.now() - t0), device: loaded.device };
  });
  queue = job.then(
    () => {},
    () => {},
  );
  return job;
}

window.api.on('engine:cmd', async (c: Cmd) => {
  try {
    switch (c.cmd) {
      case 'status':
        return reply(c.id, { ok: true, cached: await cached(), loaded, gpu: await hasGpu(), isolated: self.crossOriginIsolated });
      case 'load':
        await load(c.model!, c.device);
        return reply(c.id, { ok: true, loaded, cached: await cached() });
      case 'transcribe':
        return reply(c.id, { ok: true, ...(await transcribe(c)) });
      case 'delete':
        await remove(c.model!);
        return reply(c.id, { ok: true, cached: await cached() });
      case 'unload':
        await unload();
        return reply(c.id, { ok: true });
    }
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    event({ type: 'error', model: c.model, message: msg });
    reply(c.id, { ok: false, message: msg, offline: /fetch|network|Failed to fetch|ERR_/i.test(msg) });
  }
});

window.api.call('engine:event', { type: 'hello' });
