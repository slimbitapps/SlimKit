'use strict';
/** 16-Bit-PCM (mono) → WAV-Datei, und Aufteilen langer Aufnahmen in Stücke, die die Dienste annehmen. */

const SAMPLE_RATE = 16000;

/** @param {Int16Array} pcm */
function encodeWav(pcm, sampleRate = SAMPLE_RATE) {
  const dataBytes = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, dataBytes).copy(buf, 44);
  return buf;
}

/** Abschnitte hintereinander, mit kurzer Stille dazwischen */
function concatPcm(chunks, gapMs = 300, sampleRate = SAMPLE_RATE) {
  const gap = Math.round((gapMs / 1000) * sampleRate);
  const total = chunks.reduce((n, c) => n + c.length, 0) + gap * Math.max(0, chunks.length - 1);
  const out = new Int16Array(total);
  let o = 0;
  chunks.forEach((c, i) => {
    if (i > 0) o += gap;
    out.set(c, o);
    o += c.length;
  });
  return out;
}

/** Abschnitte zu Gruppen von höchstens maxSeconds zusammenfassen (Grenzen nur an Sprechpausen) */
function groupChunks(chunks, maxSeconds, sampleRate = SAMPLE_RATE) {
  const max = maxSeconds * sampleRate;
  const groups = [];
  let cur = [];
  let len = 0;
  for (const c of chunks) {
    if (cur.length && len + c.length > max) {
      groups.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(c);
    len += c.length;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

const seconds = (pcm, sampleRate = SAMPLE_RATE) => pcm.length / sampleRate;

module.exports = { encodeWav, concatPcm, groupChunks, seconds, SAMPLE_RATE };
