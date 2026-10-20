'use strict';
/**
 * Rechtsklick-Menü einrichten – ohne Admin-Rechte, nur für den eigenen Benutzer.
 *  - Windows: Kontextmenü-Einträge (Registry unter HKCU) als Untermenü „SlimKit“ + „Senden an“
 *  - Mac:     „Schnellaktionen“ im Finder (Automator-Workflows in ~/Library/Services)
 * Und: Start-Argumente auswerten (--action=… + Pfade).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/** Alle Werkzeuge, die direkt aus dem Rechtsklick-Menü starten können. on: wo sie erscheinen */
const MENU_ACTIONS = [
  { id: 'open', on: ['file', 'dir', 'bg'], mac: true },
  { id: 'structure', on: ['dir'], mac: true },
  { id: 'rename', on: ['file', 'dir'], mac: true },
  { id: 'images', on: ['file', 'dir'], mac: true },
  { id: 'send', on: ['file', 'dir'], mac: true },
  { id: 'receive', on: ['dir', 'bg'], mac: true },
  { id: 'dates', on: ['file', 'dir'], mac: false },
  { id: 'sort', on: ['dir'], mac: false },
  { id: 'pdf', on: ['file'], mac: false },
  { id: 'copypath', on: ['file', 'dir'], mac: false },
  { id: 'newfile', on: ['dir', 'bg'], mac: false },
];
const ACTION_IDS = new Set([
  ...MENU_ACTIONS.map((a) => a.id),
  'flatten', 'empty', 'dupes', 'size', 'list', 'hash', 'newfolder',
]);

/**
 * Start-Argumente auswerten. Chromium kann die Reihenfolge ändern → robust suchen.
 * @param {string[]} argv
 * @param {{skip?: string[], exists?: (p:string)=>boolean}} [o]
 */
function parseLaunch(argv, o = {}) {
  const skip = new Set((o.skip || []).map((p) => path.resolve(p)));
  const exists = o.exists || ((p) => fs.existsSync(p));
  let action = null;
  const paths = [];
  // argv[0] ist immer das Programm selbst
  for (let i = 1; i < argv.length; i++) {
    const a = String(argv[i] || '');
    const m = /^--action=([\w-]+)$/.exec(a);
    if (m) {
      if (ACTION_IDS.has(m[1])) action = m[1];
      continue;
    }
    if (a === '--action' && argv[i + 1]) {
      if (ACTION_IDS.has(argv[i + 1])) action = argv[i + 1];
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    // Windows hängt bei "Hintergrund" manchmal ein Anführungszeichen an ("C:\Ordner\"")
    const clean = a.replace(/"+$/, '');
    if (!path.isAbsolute(clean)) continue;
    const abs = path.resolve(clean);
    if (skip.has(abs) || /\.(exe|asar)$/i.test(abs) || /\/MacOS\/[^/]+$/.test(abs)) continue;
    if (exists(abs) && !paths.includes(abs)) paths.push(abs);
  }
  return { action: action || (paths.length ? 'open' : null), paths };
}

// ------------------------------------------------------------------ Windows
const WIN_ROOTS = {
  file: 'HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SlimKit',
  dir: 'HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\SlimKit',
  bg: 'HKEY_CURRENT_USER\\Software\\Classes\\Directory\\Background\\shell\\SlimKit',
};

const regStr = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/**
 * Inhalt einer .reg-Datei für das Untermenü „SlimKit“.
 * @param {{launcher: string[], icon: string, actions: string[], labels: Record<string,string>, title?: string}} o
 *        launcher = Programm (+ App-Ordner im Entwicklungsmodus), labels = Menütexte je Aktion
 */
function winRegFile(o) {
  const exe = o.launcher.map((x) => `"${x}"`).join(' ');
  const lines = ['Windows Registry Editor Version 5.00', ''];
  for (const [where, root] of Object.entries(WIN_ROOTS)) {
    const acts = MENU_ACTIONS.filter((a) => a.on.includes(where) && o.actions.includes(a.id));
    lines.push(`[-${root}]`, '');
    if (!acts.length) continue;
    lines.push(`[${root}]`, `"MUIVerb"=${regStr(o.title || 'SlimKit')}`, `"Icon"=${regStr(o.icon)}`, '"SubCommands"=""', '"MultiSelectModel"="Player"', '');
    acts.forEach((a, i) => {
      const key = `${root}\\shell\\${String(i + 1).padStart(2, '0')}${a.id}`;
      const arg = where === 'bg' ? '"%V"' : '"%1"';
      lines.push(`[${key}]`, `"MUIVerb"=${regStr(o.labels[a.id] || a.id)}`, '"MultiSelectModel"="Player"');
      if (a.id === 'open') lines.push(`"Icon"=${regStr(o.icon)}`);
      lines.push('', `[${key}\\command]`, `@=${regStr(`${exe} --action=${a.id} ${arg}`)}`, '');
    });
  }
  return lines.join('\r\n');
}

/** .reg-Datei, die alles wieder entfernt */
function winRegRemoveFile() {
  return ['Windows Registry Editor Version 5.00', '', ...Object.values(WIN_ROOTS).flatMap((r) => [`[-${r}]`, '']), ''].join('\r\n');
}

/** reg.exe erwartet UTF-16 mit BOM */
function utf16(s) {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
}

// ------------------------------------------------------------------ Mac (Schnellaktionen)
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sh = (s) => "'" + String(s).replace(/'/g, `'\\''`) + "'";

/**
 * Shell-Befehl der Schnellaktion. Läuft SlimKit schon, übernimmt die laufende App die Dateien
 * (zweiter Start meldet sich bei der ersten und beendet sich sofort).
 */
function macScript(launcher, bundle, action) {
  const direct = launcher.map(sh).join(' ');
  if (!bundle) return `nohup ${direct} --action=${action} "$@" >/dev/null 2>&1 &`;
  return [
    `if /usr/bin/pgrep -xq ${sh(path.basename(launcher[0]))}; then`,
    `  nohup ${direct} --action=${action} "$@" >/dev/null 2>&1 &`,
    'else',
    `  /usr/bin/open -a ${sh(bundle)} --args --action=${action} "$@"`,
    'fi',
  ].join('\n');
}

function macInfoPlist(name) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>NSActionTemplate</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>${xml(name)}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.item</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`;
}

function macWflow(script) {
  const u = () => crypto.randomUUID().toUpperCase();
  const arg = (i, name, def, type = '0') =>
    `<key>${i}</key><dict><key>default value</key>${def}<key>name</key><string>${name}</string><key>required</key><string>0</string><key>type</key><string>${type}</string><key>uuid</key><string>${i}</string></dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>523</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>${xml(script)}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/bash</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>${u()}</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
				</array>
				<key>OutputUUID</key>
				<string>${u()}</string>
				<key>UUID</key>
				<string>${u()}</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict>
					${arg(0, 'inputMethod', '<integer>0</integer>')}
					${arg(1, 'source', '<string></string>')}
					${arg(2, 'CheckedForUserDefaultShell', '<false/>')}
					${arg(3, 'COMMAND_STRING', '<string></string>')}
					${arg(4, 'shell', '<string></string>')}
				</dict>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>449.000000:305.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleIDsByPath</key>
		<dict/>
		<key>applicationPaths</key>
		<array/>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>15</integer>
		<key>processesInput</key>
		<integer>0</integer>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceApplicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<integer>0</integer>
		<key>systemImageName</key>
		<string>NSActionTemplate</string>
		<key>useAutomaticInputType</key>
		<integer>0</integer>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
`;
}

const MAC_PREFIX = 'SlimKit';

/**
 * Schnellaktionen anlegen. Vorherige SlimKit-Schnellaktionen werden vorher entfernt.
 * @param {{dir:string, launcher:string[], bundle?:string, actions:string[], labels:Record<string,string>}} o
 * @returns {string[]} angelegte Workflow-Ordner
 */
function installMac(o) {
  removeMac(o.dir);
  fs.mkdirSync(o.dir, { recursive: true });
  const made = [];
  for (const a of MENU_ACTIONS) {
    if (!a.mac && !o.actions.includes(a.id)) continue;
    if (!o.actions.includes(a.id)) continue;
    const label = o.labels[a.id] || a.id;
    const name = a.id === 'open' ? `${MAC_PREFIX} …` : `${MAC_PREFIX}: ${label}`;
    const wf = path.join(o.dir, safeFile(name) + '.workflow', 'Contents');
    fs.mkdirSync(wf, { recursive: true });
    fs.writeFileSync(path.join(wf, 'Info.plist'), macInfoPlist(name));
    fs.writeFileSync(path.join(wf, 'document.wflow'), macWflow(macScript(o.launcher, o.bundle, a.id)));
    made.push(path.dirname(wf));
  }
  return made;
}
function removeMac(dir) {
  let list = [];
  try {
    list = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let n = 0;
  for (const f of list) {
    if (f.startsWith(MAC_PREFIX) && f.endsWith('.workflow')) {
      fs.rmSync(path.join(dir, f), { recursive: true, force: true });
      n++;
    }
  }
  return n;
}
function macInstalled(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.startsWith(MAC_PREFIX) && f.endsWith('.workflow')).length;
  } catch {
    return 0;
  }
}
const safeFile = (s) => s.replace(/[/:]/g, '-').replace(/…/g, '...').trim();

module.exports = { MENU_ACTIONS, ACTION_IDS, parseLaunch, winRegFile, winRegRemoveFile, utf16, installMac, removeMac, macInstalled, macScript, macWflow, macInfoPlist };
