'use strict';
/**
 * Text dort einfügen, wo gerade der Cursor steht – in jeder App.
 *  Windows: kleines PowerShell-Hilfsprogramm (bleibt im Hintergrund offen) mit SendInput
 *  Mac:     AppleScript über „System Events“ (braucht die Freigabe „Bedienungshilfen“)
 *  Linux:   xdotool, falls installiert
 * Und: welche App ist gerade vorne (für App-Profile)?
 */
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const WIN_HELPER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public static class SVInput {
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  const uint KEYUP = 2, UNICODE = 4;
  static INPUT Key(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i; }
  static void Send(List<INPUT> l) { if (l.Count > 0) SendInput((uint)l.Count, l.ToArray(), Marshal.SizeOf(typeof(INPUT))); }
  // Warten, bis Strg/Umschalt/Alt/Win losgelassen sind – sonst wird aus Strg+V z. B. Strg+Umschalt+V
  static void WaitModifiers() {
    int[] mods = { 0x10, 0x11, 0x12, 0x5B, 0x5C };
    for (int n = 0; n < 60; n++) { bool down = false; foreach (int vk in mods) if ((GetAsyncKeyState(vk) & 0x8000) != 0) down = true; if (!down) return; Thread.Sleep(25); }
  }
  public static void Paste() { WaitModifiers(); Send(new List<INPUT> { Key(0x11, 0, 0), Key(0x56, 0, 0), Key(0x56, 0, KEYUP), Key(0x11, 0, KEYUP) }); }
  public static void Type(string s) {
    WaitModifiers();
    var l = new List<INPUT>();
    foreach (char c in s) {
      if (c == '\r') continue;
      if (c == '\n') { l.Add(Key(0x0D, 0, 0)); l.Add(Key(0x0D, 0, KEYUP)); continue; }
      l.Add(Key(0, c, UNICODE)); l.Add(Key(0, c, UNICODE | KEYUP));
    }
    Send(l);
  }
  public static string Foreground() {
    try { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
  }
}
'@
[Console]::Out.WriteLine('READY')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $parts = $line.Split(' ', 2)
    $arg = ''
    if ($parts.Length -gt 1) { $arg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1])) }
    switch ($parts[0]) {
      'paste' { [SVInput]::Paste(); [Console]::Out.WriteLine('OK') }
      'type'  { [SVInput]::Type($arg); [Console]::Out.WriteLine('OK') }
      'fg'    { [Console]::Out.WriteLine('OK ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([SVInput]::Foreground()))) }
      default { [Console]::Out.WriteLine('ERR unknown') }
    }
  } catch { [Console]::Out.WriteLine('ERR ' + $_.Exception.Message.Replace([Environment]::NewLine, ' ')) }
}
`;

/** Hält das PowerShell-Hilfsprogramm offen und schickt ihm Befehle (eine Zeile hin, eine zurück) */
class WinHelper {
  constructor(dir, log) {
    this.dir = dir;
    this.log = log;
    this.proc = null;
    this.queue = [];
    this.buf = '';
    this.ready = null;
  }
  start() {
    if (this.proc) return this.ready;
    const file = path.join(this.dir, 'slimvoice-input.ps1');
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(file, '﻿' + WIN_HELPER, 'utf8');
    this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.ready = new Promise((resolve) => {
      this.onReady = resolve;
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (line === 'READY') this.onReady?.();
        else if (line) this.queue.shift()?.(line);
      }
    });
    this.proc.stderr.on('data', (d) => this.log?.('input helper', String(d)));
    this.proc.on('exit', () => {
      this.proc = null;
      for (const cb of this.queue.splice(0)) cb('ERR exited');
    });
    return this.ready;
  }
  async send(cmd, arg) {
    await this.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('input helper timeout')), 8000);
      this.queue.push((line) => {
        clearTimeout(timer);
        if (line.startsWith('OK')) resolve(line.slice(3));
        else reject(new Error(line));
      });
      this.proc.stdin.write(cmd + (arg !== undefined ? ' ' + Buffer.from(arg, 'utf8').toString('base64') : '') + '\n');
    });
  }
  stop() {
    try {
      this.proc?.stdin.end();
      this.proc?.kill();
    } catch {
      /* egal */
    }
    this.proc = null;
  }
}

function run(cmd, args, timeout = 5000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim())));
  });
}
const appleString = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Inserter {
  /**
   * @param {{ clipboard: Electron.Clipboard, platform?: string, dataDir: string, log?: Function, testFile?: string }} o
   */
  constructor(o) {
    this.clipboard = o.clipboard;
    this.platform = o.platform || process.platform;
    this.testFile = o.testFile;
    this.log = o.log;
    this.win = this.platform === 'win32' && !this.testFile ? new WinHelper(o.dataDir, o.log) : null;
    this.chain = Promise.resolve();
  }
  warmup() {
    this.win?.start().catch(() => {});
  }
  dispose() {
    this.win?.stop();
  }

  /** Nacheinander einfügen, auch wenn mehrere Abschnitte gleichzeitig fertig werden */
  insert(text, method = 'paste', restore = true) {
    const job = this.chain.then(() => this.#insert(text, method, restore));
    this.chain = job.catch(() => {});
    return job;
  }

  async #insert(text, method, restore) {
    if (!text) return;
    if (this.testFile) {
      fs.appendFileSync(this.testFile, text);
      return;
    }
    if (method === 'copy') {
      this.clipboard.writeText(text);
      return;
    }
    if (method === 'type' && this.platform === 'win32') {
      await this.win.send('type', text);
      return;
    }
    if (method === 'type' && this.platform === 'darwin' && !/[\n\t]/.test(text)) {
      await run('osascript', ['-e', `tell application "System Events" to keystroke ${appleString(text)}`]);
      return;
    }
    // Über die Zwischenablage: alten Inhalt merken, einfügen, wiederherstellen
    const saved = restore ? this.#saveClipboard() : null;
    this.clipboard.writeText(text);
    await this.#pasteKey();
    if (saved) {
      await sleep(350);
      if (this.clipboard.readText() === text) this.#restoreClipboard(saved);
    }
  }

  async #pasteKey() {
    if (this.platform === 'win32') return this.win.send('paste');
    if (this.platform === 'darwin') {
      await sleep(60);
      return run('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    }
    return run('xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
  }

  #saveClipboard() {
    try {
      const formats = this.clipboard.availableFormats();
      const saved = { text: this.clipboard.readText(), html: '', image: null };
      if (formats.some((f) => f.includes('html'))) saved.html = this.clipboard.readHTML();
      if (formats.some((f) => f.startsWith('image/'))) {
        const img = this.clipboard.readImage();
        if (!img.isEmpty()) saved.image = img;
      }
      return saved;
    } catch {
      return null;
    }
  }
  #restoreClipboard(s) {
    try {
      const data = {};
      if (s.text) data.text = s.text;
      if (s.html) data.html = s.html;
      if (s.image) data.image = s.image;
      if (Object.keys(data).length) this.clipboard.write(data);
      else this.clipboard.clear();
    } catch {
      /* egal */
    }
  }

  /** Name der App im Vordergrund, z. B. „OUTLOOK“, „Slack“, „Code“ */
  async foregroundApp() {
    if (this.testFile) return process.env.SLIMVOICE_FG_APP || '';
    try {
      if (this.platform === 'win32') {
        const b64 = await this.win.send('fg');
        return Buffer.from(b64, 'base64').toString('utf8');
      }
      if (this.platform === 'darwin') {
        return await run('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], 2500);
      }
      return await run('xdotool', ['getactivewindow', 'getwindowclassname'], 1500);
    } catch {
      return '';
    }
  }
}

module.exports = { Inserter, WinHelper };
