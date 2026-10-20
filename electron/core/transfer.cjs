'use strict';
/**
 * Dateien übertragen ohne App und ohne Internet:
 * Ein kleiner Webserver im lokalen Netz. Das andere Gerät scannt den QR-Code und öffnet eine Webseite.
 *  - mode 'send':    Webseite zeigt die Dateien zum Herunterladen (einzeln oder als ZIP)
 *  - mode 'receive': Webseite lässt Fotos/Dateien auswählen und lädt sie in den gewählten Ordner hoch
 *
 * Schutz: geheimer Zufallscode in der Adresse (nur wer den QR-Code sieht, kommt rein),
 * nur Geräte aus dem lokalen Netz, nur IP-Adressen als Host (gegen DNS-Rebinding),
 * Sperre nach Fehlversuchen, Sitzung endet von selbst nach längerer Pause.
 */
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { isPrivateIp } = require('./network.cjs');
const { safeName, uniquePath, kindOf } = require('./fsutil.cjs');
const { writeZip, zipSize } = require('./zip.cjs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};
const HOST_RE = /^(\d{1,3}(\.\d{1,3}){3}|localhost|\[[0-9a-fA-F:]+\])(:\d{1,5})?$/;
const MAX_FAILS = 8;
const BLOCK_MS = 60_000;
const MAX_UPLOAD = 50 * 1024 ** 3;
const PAGE_CSP = "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'";

const newToken = () => crypto.randomBytes(18).toString('base64url');
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Kurzer Gerätename aus dem Browser-Kennzeichen ("iPhone", "Android", "Windows-PC" …) */
function deviceName(ua = '') {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android' : 'Android Tablet';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Browser';
}

class TransferServer extends EventEmitter {
  /** @param {{root:string, port?:number, host?:string, allowAnyIp?:boolean}} opts root = Ordner mit phone.html und assets/ */
  constructor({ root, port = 8643, host = '0.0.0.0', allowAnyIp = false }) {
    super();
    this.root = root;
    this.wantedPort = port;
    this.host = host;
    this.allowAnyIp = allowAnyIp;
    this.port = 0;
    this.server = null;
    this.session = null;
    this.fails = new Map();
    this.lastHit = 0;
  }

  async start() {
    if (this.server) return this.port;
    this.server = http.createServer((req, res) => this.onHttp(req, res).catch((e) => this.emit('error', e) && fail(res, 500)));
    this.server.requestTimeout = 0; // große Uploads dürfen dauern
    this.server.headersTimeout = 20_000;
    this.port = await listen(this.server, this.wantedPort, this.host).catch(() => listen(this.server, 0, this.host));
    return this.port;
  }
  async stop() {
    this.session = null;
    const s = this.server;
    this.server = null;
    if (s) {
      s.closeAllConnections?.();
      await new Promise((r) => s.close(() => r()));
    }
  }

  /**
   * Neue Sitzung (die alte endet).
   * @param {{mode:'send'|'receive', files?:{path:string, name?:string, size:number, mtimeMs?:number, rel?:string}[], dir?:string, title?:string}} s
   */
  open(s) {
    const files = (s.files || []).map((f, i) => ({ id: i, path: f.path, name: f.name || path.basename(f.path), rel: f.rel || f.name || path.basename(f.path), size: f.size, mtimeMs: f.mtimeMs || 0 }));
    this.session = { token: newToken(), mode: s.mode, files, dir: s.dir || '', title: s.title || '', created: Date.now(), active: Date.now(), devices: new Map(), received: [] };
    return this.session;
  }
  close() {
    this.session = null;
  }
  info() {
    const s = this.session;
    if (!s) return null;
    return { token: s.token, mode: s.mode, dir: s.dir, count: s.files.length, active: s.active, devices: [...s.devices.values()], received: s.received.slice(-200) };
  }

  // ------------------------------------------------------------------ Zugriffsschutz
  ipOf(req) {
    return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  }
  blocked(ip) {
    const f = this.fails.get(ip);
    return !!(f && f.until > Date.now());
  }
  fail(ip) {
    const f = this.fails.get(ip) || { n: 0, until: 0 };
    if (++f.n >= MAX_FAILS) {
      f.until = Date.now() + BLOCK_MS;
      f.n = 0;
    }
    this.fails.set(ip, f);
  }

  async onHttp(req, res) {
    const ip = this.ipOf(req);
    if ((!this.allowAnyIp && !isPrivateIp(ip)) || !HOST_RE.test(String(req.headers.host || '')) || this.blocked(ip)) return fail(res, 403);
    const url = new URL(req.url || '/', 'http://x');
    const m = /^\/s\/([\w-]{10,64})(\/.*)?$/.exec(url.pathname);
    const s = this.session;
    if (!m || !s || !safeEqual(m[1], s.token)) {
      this.fail(ip);
      return sendHtml(res, 404, this.goneHtml());
    }
    this.lastHit = Date.now();
    s.active = Date.now();
    const sub = m[2] || '';
    if (sub === '') {
      res.writeHead(302, { Location: `/s/${s.token}/` }).end();
      return;
    }
    if (!s.devices.has(ip)) {
      s.devices.set(ip, { ip, name: deviceName(req.headers['user-agent']), at: Date.now() });
      this.emit('visit', s.devices.get(ip));
    }
    if (sub === '/' && req.method === 'GET') return this.serveStatic(res, 'phone.html', true);
    if (/^\/assets\/[\w.-]+$/.test(sub) && req.method === 'GET') return this.serveStatic(res, sub.slice(1));
    if (sub === '/icon.png') return this.serveStatic(res, 'icon.png');
    if (sub === '/api/info' && req.method === 'GET') {
      return sendJson(res, {
        mode: s.mode,
        title: s.title,
        folder: s.mode === 'receive' ? path.basename(s.dir) : '',
        files: s.mode === 'send' ? s.files.map((f) => ({ id: f.id, name: f.name, rel: f.rel, size: f.size, kind: kindOf(f.name) })) : [],
        zip: s.mode === 'send' && s.files.length > 1 ? zipSize(s.files.map((f) => ({ name: f.rel, size: f.size }))) : -1,
        received: s.mode === 'receive' ? s.received.filter((r) => r.ip === ip).map((r) => ({ name: r.name, size: r.size })) : [],
      });
    }
    const fm = /^\/f\/(\d+)(?:\/[^/]*)?$/.exec(sub);
    if (fm && s.mode === 'send' && (req.method === 'GET' || req.method === 'HEAD')) return this.serveFile(req, res, s.files[Number(fm[1])], url.searchParams.has('dl'), ip);
    if (/^\/zip(\/[^/]*)?$/.test(sub) && s.mode === 'send' && req.method === 'GET') return this.serveZip(res, s, ip);
    if (sub === '/up' && s.mode === 'receive' && req.method === 'POST') return this.receive(req, res, s, ip);
    return fail(res, 404);
  }

  goneHtml() {
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SlimKit</title>
<body style="font:17px -apple-system,system-ui,sans-serif;background:#121316;color:#eee;display:grid;place-items:center;min-height:90vh;text-align:center;padding:24px">
<div><h2>SlimKit</h2><p>Dieser QR-Code ist abgelaufen. Bitte den neuen QR-Code scannen.<br><br>This QR code has expired. Please scan the new one.</p></div>`;
  }

  async serveStatic(res, rel, isPage) {
    const file = path.join(this.root, rel);
    if (!path.resolve(file).startsWith(path.resolve(this.root) + path.sep)) return fail(res, 404);
    let buf;
    try {
      buf = await fsp.readFile(file);
    } catch {
      return fail(res, 404);
    }
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': isPage ? 'no-store' : 'max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (isPage) Object.assign(headers, { 'Content-Security-Policy': PAGE_CSP, 'X-Frame-Options': 'DENY' });
    res.writeHead(200, headers).end(buf);
  }

  async serveFile(req, res, f, download, ip) {
    if (!f) return fail(res, 404);
    let st;
    try {
      st = await fsp.stat(f.path);
    } catch {
      return fail(res, 404);
    }
    const type = MIME[path.extname(f.name).toLowerCase()] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${asciiName(f.name)}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    };
    let start = 0;
    let end = st.size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    let status = 200;
    if (range && st.size > 0) {
      if (range[1] === '') start = Math.max(0, st.size - Number(range[2]));
      else {
        start = Number(range[1]);
        if (range[2] !== '') end = Math.min(end, Number(range[2]));
      }
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end();
        return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = st.size === 0 ? 0 : end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || st.size === 0) return res.end();
    if (download && start === 0) this.emit('download', { ip, name: f.name, size: st.size });
    fs.createReadStream(f.path, { start, end }).on('error', () => res.destroy()).pipe(res);
  }

  async serveZip(res, s, ip) {
    const entries = [];
    for (const f of s.files) {
      const st = await fsp.stat(f.path).catch(() => null);
      if (st) entries.push({ path: f.path, name: f.rel, size: st.size, mtimeMs: st.mtimeMs });
    }
    const size = zipSize(entries);
    if (size < 0) return fail(res, 413);
    const name = (s.title || 'SlimKit') + '.zip';
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': size,
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    this.emit('download', { ip, name, size, zip: true });
    try {
      await writeZip(entries, res);
      res.end();
    } catch {
      res.destroy();
    }
  }

  async receive(req, res, s, ip) {
    let name;
    try {
      name = decodeURIComponent(String(req.headers['x-name'] || ''));
    } catch {
      name = '';
    }
    name = safeName(path.basename(name.replace(/\\/g, '/')), 'upload');
    const size = Number(req.headers['content-length'] || req.headers['x-size'] || 0);
    if (!s.dir || size > MAX_UPLOAD) return fail(res, 413);
    await fsp.mkdir(s.dir, { recursive: true });
    const id = crypto.randomUUID();
    const part = path.join(s.dir, `.${id}.slimkit-part`);
    const item = { id, ip, name, size, received: 0, device: s.devices.get(ip)?.name || '' };
    this.emit('upload-start', item);
    let last = 0;
    const out = fs.createWriteStream(part, { flags: 'wx' });
    req.on('data', (c) => {
      item.received += c.length;
      if (Date.now() - last > 250) {
        last = Date.now();
        s.active = Date.now();
        this.emit('upload-progress', { id, name, size, received: item.received });
      }
    });
    const ok = await new Promise((resolve) => {
      req.on('aborted', () => resolve(false));
      out.on('error', () => resolve(false));
      out.on('finish', () => resolve(true));
      req.pipe(out);
    });
    if (!ok || (size && item.received !== size)) {
      out.destroy();
      await fsp.rm(part, { force: true });
      this.emit('upload-failed', { id, name });
      if (!res.headersSent) fail(res, 400);
      return;
    }
    const final = uniquePath(path.join(s.dir, name));
    await fsp.rename(part, final);
    const lm = Number(req.headers['x-modified'] || 0);
    if (lm > 0 && lm < Date.now() + 86400000) await fsp.utimes(final, new Date(), new Date(lm)).catch(() => {});
    const rec = { id, ip, name: path.basename(final), path: final, size: item.received, at: Date.now(), device: item.device };
    s.received.push(rec);
    this.emit('upload-done', rec);
    sendJson(res, { ok: true, name: rec.name });
  }
}

function asciiName(n) {
  return String(n).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
}
function fail(res, code) {
  if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'text/plain' });
  res.end(String(code));
}
function sendJson(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));
}
function sendHtml(res, code, html) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
}
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => {
      server.off('listening', onOk);
      reject(e);
    };
    const onOk = () => {
      server.off('error', onErr);
      resolve(server.address().port);
    };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(port, host);
  });
}

module.exports = { TransferServer, deviceName };
