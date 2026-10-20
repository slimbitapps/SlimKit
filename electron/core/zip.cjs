'use strict';
/**
 * Einfacher ZIP-Schreiber (ohne Komprimierung – Fotos/Videos sind schon komprimiert).
 * Streamt direkt ins Netz; die Gesamtgröße steht vorher fest (für den Fortschritt am Handy).
 */
const fs = require('node:fs');

const TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c;
}
function crc32(buf, crc = 0) {
  let c = ~crc;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function crcFile(file) {
  return new Promise((resolve, reject) => {
    let c = 0;
    fs.createReadStream(file)
      .on('data', (b) => (c = crc32(b, c)))
      .on('error', reject)
      .on('end', () => resolve(c));
  });
}
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const LIMIT = 0xfffffff0;

/** Gesamtgröße der ZIP-Datei (oder -1, wenn zu groß für das einfache ZIP-Format) */
function zipSize(entries) {
  let total = 22;
  for (const e of entries) {
    const n = Buffer.byteLength(e.name);
    total += 30 + n + e.size + 46 + n;
  }
  return total > LIMIT || entries.length > 65000 ? -1 : total;
}

/**
 * @param {{path:string, name:string, size:number, mtimeMs:number}[]} entries name = Pfad im ZIP ("Ordner/Bild.jpg")
 * @param {import('node:stream').Writable} out
 */
async function writeZip(entries, out, onBytes) {
  const write = (buf) =>
    new Promise((resolve, reject) => {
      if (out.destroyed) return reject(new Error('closed'));
      out.write(buf, (err) => (err ? reject(err) : resolve()));
    });
  let offset = 0;
  const central = [];
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = await crcFile(e.path);
    const { time, date } = dosTime(new Date(e.mtimeMs || Date.now()));
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8-Namen
    h.writeUInt16LE(0, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(e.size, 18);
    h.writeUInt32LE(e.size, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(0, 28);
    await write(Buffer.concat([h, name]));
    for await (const chunk of fs.createReadStream(e.path)) {
      await write(chunk);
      if (onBytes) onBytes(chunk.length);
    }
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(e.size, 20);
    c.writeUInt32LE(e.size, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([c, name]));
    offset += 30 + name.length + e.size;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(Buffer.concat([cd, end]));
}

module.exports = { writeZip, zipSize, crc32 };
