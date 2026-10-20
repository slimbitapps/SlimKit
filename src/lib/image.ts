import { call } from '../store';

export type ImgOpts = {
  /** längste Seite in Pixel (0 = unverändert) */
  maxSide: number;
  /** Prozent der Originalgröße (statt maxSide, wenn > 0) */
  percent: number;
  format: 'same' | 'jpeg' | 'png' | 'webp';
  quality: number; // 1–100
  /** Zielgröße in KB (0 = egal) */
  targetKB: number;
  /** auch vergrößern erlaubt */
  upscale: boolean;
};

const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' } as const;

export function outFormat(srcExt: string, f: ImgOpts['format']): keyof typeof MIME {
  if (f !== 'same') return f;
  if (srcExt === 'png' || srcExt === 'gif' || srcExt === 'bmp') return 'png';
  if (srcExt === 'webp') return 'webp';
  return 'jpeg';
}

/** Zielmaße berechnen */
export function targetSize(w: number, h: number, o: Pick<ImgOpts, 'maxSide' | 'percent' | 'upscale'>) {
  let s = 1;
  if (o.percent > 0) s = o.percent / 100;
  else if (o.maxSide > 0) s = o.maxSide / Math.max(w, h);
  if (s > 1 && !o.upscale) s = 1;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Schrittweise verkleinern (sieht deutlich schärfer aus als in einem Schritt) */
function draw(src: ImageBitmap | OffscreenCanvas, w: number, h: number, opaque: boolean): OffscreenCanvas {
  let cur: ImageBitmap | OffscreenCanvas = src;
  let cw = src.width;
  let ch = src.height;
  while (cw / 2 > w && ch / 2 > h) {
    cw = Math.round(cw / 2);
    ch = Math.round(ch / 2);
    const c = new OffscreenCanvas(cw, ch);
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, cw, ch);
    cur = c;
  }
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d')!;
  if (opaque) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, w, h);
  return out;
}

/** Bild laden (HEIC wandelt der Mac vorher um) */
export async function loadBitmap(path: string) {
  const { bytes, type } = await call<{ bytes: Uint8Array; type: string }>('images:read', path);
  return createImageBitmap(new Blob([bytes as BlobPart], { type }), { imageOrientation: 'from-image' });
}

/**
 * Ein Bild umwandeln. Gibt die neuen Bytes und Maße zurück (gespeichert wird im Hauptprozess).
 */
export async function convert(path: string, ext: string, o: ImgOpts) {
  const bmp = await loadBitmap(path);
  const fmt = outFormat(ext, o.format);
  let { w, h } = targetSize(bmp.width, bmp.height, o);
  let q = Math.min(1, Math.max(0.1, o.quality / 100));
  const encode = async (cw: number, ch: number, quality: number) => draw(bmp, cw, ch, fmt === 'jpeg').convertToBlob({ type: MIME[fmt], quality });
  let blob = await encode(w, h, q);
  if (o.targetKB > 0) {
    const limit = o.targetKB * 1024;
    // Erst Qualität suchen (Halbierung), dann notfalls kleiner machen
    for (let round = 0; round < 6 && blob.size > limit; round++) {
      if (fmt !== 'png') {
        let lo = 0.3;
        let hi = q;
        let best: Blob | null = null;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          const b = await encode(w, h, mid);
          if (b.size <= limit) {
            best = b;
            lo = mid;
          } else hi = mid;
        }
        if (best) {
          blob = best;
          break;
        }
      }
      w = Math.max(1, Math.round(w * 0.8));
      h = Math.max(1, Math.round(h * 0.8));
      blob = await encode(w, h, fmt === 'png' ? 1 : 0.75);
    }
  }
  const before = { w: bmp.width, h: bmp.height };
  bmp.close();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: EXT[fmt], w, h, before };
}

/** Bild als JPEG-Bytes (für PDF aus HEIC/WebP/GIF) */
export async function toJpeg(path: string) {
  const bmp = await loadBitmap(path);
  const blob = await draw(bmp, bmp.width, bmp.height, true).convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  bmp.close();
  return new Uint8Array(await blob.arrayBuffer());
}
