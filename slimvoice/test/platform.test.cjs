'use strict';
/**
 * Läuft nur auf dem jeweiligen System (in GitHub Actions auf echtem Windows bzw. Mac):
 * Prüft, dass das Einfüge-Hilfsprogramm startet und antwortet.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { WinHelper } = require('../electron/core/inserter.cjs');

test('Windows: PowerShell-Hilfsprogramm kompiliert und antwortet', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-win-'));
  const h = new WinHelper(dir, (...a) => console.error(...a));
  try {
    const fg = await h.send('fg');
    assert.equal(typeof fg, 'string');
    // leerer Text → keine Tastendrücke, aber der Befehl muss durchlaufen
    assert.equal(await h.send('type', ''), '');
  } finally {
    h.stop();
  }
});
