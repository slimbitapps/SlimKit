'use strict';
/** Tests des Übertragungs-Servers (Senden, ZIP, Empfangen, Schutz) */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { TransferServer, deviceName } = require('../electron/core/transfer.cjs');

function req(port, p, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

test('Senden, ZIP, Empfangen, Schutz', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'slimkit-tr-'));
  const root = path.join(d, 'web');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'phone.html'), '<!doctype html><title>phone</title>');
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(d, 'a.txt'), 'Hallo');
  fs.writeFileSync(path.join(d, 'Bild ä.jpg'), Buffer.alloc(5000, 7));
  const srv = new TransferServer({ root, port: 0 });
  const port = await srv.start();
  try {
    // Ohne Sitzung: nichts
    assert.equal((await req(port, '/s/abcdefghijklmnop/')).status, 404);
    const s = srv.open({ mode: 'send', title: 'Test', files: ['a.txt', 'Bild ä.jpg'].map((n) => ({ path: path.join(d, n), size: fs.statSync(path.join(d, n)).size })) });
    const base = `/s/${s.token}`;
    assert.equal((await req(port, base)).status, 302);
    const page = await req(port, base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);
    assert.equal((await req(port, base + '/assets/app.js')).status, 200);
    assert.equal((await req(port, base + '/assets/../phone.html')).status, 404);
    const info = JSON.parse((await req(port, base + '/api/info')).body);
    assert.equal(info.mode, 'send');
    assert.equal(info.files.length, 2);
    assert.ok(info.zip > 5005);
    const f = await req(port, base + '/f/0?dl=1');
    assert.equal(f.body.toString(), 'Hallo');
    assert.match(f.headers['content-disposition'], /^attachment/);
    const part = await req(port, base + '/f/1', { headers: { Range: 'bytes=10-19' } });
    assert.equal(part.status, 206);
    assert.equal(part.body.length, 10);
    const zip = await req(port, base + '/zip');
    assert.equal(zip.status, 200);
    assert.equal(zip.body.length, info.zip);
    const zf = path.join(d, 't.zip');
    fs.writeFileSync(zf, zip.body);
    try {
      const out = execFileSync('unzip', ['-t', zf]).toString();
      assert.match(out, /No errors detected/);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    // Falscher Code und falscher Host
    assert.equal((await req(port, '/s/falschfalschfalsch/api/info')).status, 404);
    assert.equal((await req(port, base + '/api/info', { headers: { Host: 'evil.example:80' } })).status, 403);
    // Upload im Sende-Modus verboten
    assert.equal((await req(port, base + '/up', { method: 'POST', body: 'x' })).status, 404);

    // Empfangen
    const inbox = path.join(d, 'inbox');
    const s2 = srv.open({ mode: 'receive', dir: inbox });
    assert.equal((await req(port, base + '/api/info')).status, 404, 'alter Code ungültig');
    const b2 = `/s/${s2.token}`;
    const done = [];
    srv.on('upload-done', (r) => done.push(r));
    const up = await req(port, b2 + '/up', { method: 'POST', headers: { 'X-Name': encodeURIComponent('../../Foto ü.jpg'), 'Content-Length': 4, 'X-Modified': String(new Date(2020, 1, 2).getTime()) }, body: 'abcd' });
    assert.equal(up.status, 200);
    assert.deepEqual(fs.readdirSync(inbox), ['Foto ü.jpg']);
    assert.equal(new Date(fs.statSync(path.join(inbox, 'Foto ü.jpg')).mtimeMs).getFullYear(), 2020);
    await req(port, b2 + '/up', { method: 'POST', headers: { 'X-Name': encodeURIComponent('Foto ü.jpg'), 'Content-Length': 2 }, body: 'xy' });
    assert.deepEqual(fs.readdirSync(inbox).sort(), ['Foto ü (2).jpg', 'Foto ü.jpg']);
    assert.equal(done.length, 2);
    const info2 = JSON.parse((await req(port, b2 + '/api/info')).body);
    assert.equal(info2.received.length, 2);
    assert.equal(srv.info().devices.length, 1);
  } finally {
    await srv.stop();
  }
});

test('Gerätename', () => {
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'iPhone');
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile'), 'Android');
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows PC');
});
