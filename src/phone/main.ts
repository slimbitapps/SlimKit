/**
 * Handy-Seite für SlimKit: Dateien vom Computer laden oder Fotos/Dateien hochladen.
 * Bewusst ohne Framework – lädt sofort, auch auf alten Handys.
 */
import './phone.css';

const de = (navigator.language || '').toLowerCase().startsWith('de');
const L = de
  ? {
      sendTitle: 'Vom Computer laden',
      files: (n: number) => (n === 1 ? '1 Datei' : `${n} Dateien`),
      all: 'Alle laden (ZIP)',
      dl: 'Laden',
      view: 'Ansehen',
      iosTip: 'Fotos speichern: Bild antippen, dann lange drücken → „Zu Fotos hinzufügen“.',
      recTitle: 'An den Computer senden',
      recInto: (f: string) => `Landet im Ordner „${f}“`,
      pick: 'Fotos oder Dateien auswählen',
      pickMore: 'Weitere auswählen',
      done: 'Fertig',
      failed: 'Fehlgeschlagen – nochmal versuchen',
      retry: 'Nochmal',
      sent: (n: number) => (n === 1 ? '1 Datei gesendet ✓' : `${n} Dateien gesendet ✓`),
      gone: 'Die Verbindung wurde beendet. Bitte den neuen QR-Code am Computer scannen.',
      offline: 'Computer nicht erreichbar. Ist SlimKit noch offen und seid ihr im selben WLAN?',
      keep: 'Bitte diese Seite offen lassen, bis alles gesendet ist.',
      by: 'Übertragen mit SlimKit – ohne App, ohne Internet',
    }
  : {
      sendTitle: 'Download from computer',
      files: (n: number) => (n === 1 ? '1 file' : `${n} files`),
      all: 'Download all (ZIP)',
      dl: 'Download',
      view: 'View',
      iosTip: 'Save photos: tap the image, then press and hold → “Add to Photos”.',
      recTitle: 'Send to computer',
      recInto: (f: string) => `Goes into the folder “${f}”`,
      pick: 'Choose photos or files',
      pickMore: 'Choose more',
      done: 'Done',
      failed: 'Failed – try again',
      retry: 'Retry',
      sent: (n: number) => (n === 1 ? '1 file sent ✓' : `${n} files sent ✓`),
      gone: 'This connection has ended. Please scan the new QR code on the computer.',
      offline: 'Can’t reach the computer. Is SlimKit still open and are you on the same Wi-Fi?',
      keep: 'Please keep this page open until everything is sent.',
      by: 'Transferred with SlimKit – no app, no internet',
    };

type Info = {
  mode: 'send' | 'receive';
  title: string;
  folder: string;
  files: { id: number; name: string; rel: string; size: number; kind: string }[];
  zip: number;
  received: { name: string; size: number }[];
};

const app = document.getElementById('app')!;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: (Node | string | null | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

function size(n: number) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 || n >= 10 ? 0 : 1)} ${u[i]}`;
}

function header(title: string, sub: string) {
  return h('header', { class: 'top' }, h('img', { src: 'icon.png', alt: '', width: 40, height: 40 }), h('div', {}, h('h1', {}, title), h('p', {}, sub)));
}

function message(text: string) {
  app.replaceChildren(h('div', { class: 'msg' }, h('img', { src: 'icon.png', alt: '', width: 56, height: 56 }), h('p', {}, text)));
}

// ------------------------------------------------------------------ Senden (Computer → Handy)
function renderSend(info: Info) {
  const total = info.files.reduce((a, f) => a + f.size, 0);
  const list = h('ul', { class: 'files' });
  for (const f of info.files) {
    const href = `f/${f.id}/${encodeURIComponent(f.name)}`;
    const thumb = f.kind === 'image' && !/\.(heic|heif|tiff?)$/i.test(f.name) ? h('img', { class: 'thumb', src: href, loading: 'lazy', alt: '' }) : h('span', { class: `thumb ic ${f.kind}` }, f.name.split('.').pop()?.slice(0, 4).toUpperCase() || '');
    list.append(
      h(
        'li',
        {},
        h('a', { class: 'open', href, target: '_blank', rel: 'noopener' }, thumb),
        h('div', { class: 'meta' }, h('b', {}, f.rel.includes('/') ? f.rel : f.name), h('span', {}, size(f.size))),
        h('a', { class: 'btn small', href: `${href}?dl=1`, download: f.name }, L.dl),
      ),
    );
  }
  const parts: (Node | null)[] = [
    header(L.sendTitle, `${L.files(info.files.length)} · ${size(total)}`),
    info.zip > 0 ? h('a', { class: 'btn big', href: `zip/${encodeURIComponent(info.title || 'SlimKit')}.zip`, download: `${info.title || 'SlimKit'}.zip`, 'data-testid': 'zip' }, `${L.all} · ${size(info.zip)}`) : null,
    ios && info.files.some((f) => f.kind === 'image') ? h('p', { class: 'tip' }, L.iosTip) : null,
    list,
    h('p', { class: 'by' }, L.by),
  ];
  app.replaceChildren(...parts.filter((x): x is Node => !!x));
}

// ------------------------------------------------------------------ Empfangen (Handy → Computer)
type Job = { file: File; li: HTMLElement; bar: HTMLElement; state: 'wait' | 'up' | 'done' | 'fail' };
function renderReceive(info: Info) {
  const jobs: Job[] = [];
  const input = h('input', { type: 'file', multiple: true, class: 'hidden', 'data-testid': 'file-input' }) as HTMLInputElement;
  const pickBtn = h('button', { class: 'btn big', onclick: () => input.click() }, L.pick);
  const list = h('ul', { class: 'files up' });
  const status = h('p', { class: 'status' });
  let active = 0;

  const update = () => {
    const done = jobs.filter((j) => j.state === 'done').length;
    const busy = jobs.some((j) => j.state === 'wait' || j.state === 'up');
    status.textContent = busy ? L.keep : done ? L.sent(done) : '';
    status.className = `status ${!busy && done ? 'ok' : ''}`;
    pickBtn.textContent = jobs.length ? L.pickMore : L.pick;
  };

  const next = () => {
    while (active < 2) {
      const j = jobs.find((x) => x.state === 'wait');
      if (!j) break;
      upload(j);
    }
    update();
  };

  const upload = (j: Job) => {
    active++;
    j.state = 'up';
    j.li.className = 'up';
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'up');
    xhr.setRequestHeader('X-Name', encodeURIComponent(j.file.name || 'upload'));
    if (j.file.lastModified) xhr.setRequestHeader('X-Modified', String(j.file.lastModified));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) j.bar.style.width = `${(e.loaded / e.total) * 100}%`;
    };
    xhr.onload = () => finish(xhr.status === 200);
    xhr.onerror = () => finish(false);
    const finish = (ok: boolean) => {
      active--;
      j.state = ok ? 'done' : 'fail';
      j.li.className = ok ? 'done' : 'fail';
      j.bar.style.width = '100%';
      if (!ok) {
        const retry = h('button', { class: 'btn small', onclick: () => ((j.state = 'wait'), retry.remove(), next()) }, L.retry);
        j.li.append(retry);
      }
      next();
    };
    xhr.send(j.file);
  };

  input.addEventListener('change', () => {
    for (const file of Array.from(input.files || [])) {
      const bar = h('i');
      const li = h('li', { class: 'wait' }, h('span', { class: 'thumb ic' }, (file.name.split('.').pop() || '').slice(0, 4).toUpperCase()), h('div', { class: 'meta' }, h('b', {}, file.name), h('span', {}, size(file.size)), h('div', { class: 'bar' }, bar)));
      list.prepend(li);
      jobs.push({ file, li, bar, state: 'wait' });
    }
    input.value = '';
    next();
  });

  window.addEventListener('beforeunload', (e) => {
    if (jobs.some((j) => j.state === 'wait' || j.state === 'up')) e.preventDefault();
  });

  app.replaceChildren(header(L.recTitle, L.recInto(info.folder)), pickBtn, input, status, list, h('p', { class: 'by' }, L.by));
  update();
}

async function start() {
  try {
    const r = await fetch('api/info', { cache: 'no-store' });
    if (!r.ok) return message(L.gone);
    const info = (await r.json()) as Info;
    if (info.mode === 'send') renderSend(info);
    else renderReceive(info);
  } catch {
    message(L.offline);
  }
}
start();
