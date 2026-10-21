'use strict';
/** Texte, die der Hauptprozess braucht (Rechtsklick-Menü, Menüleiste, Mitteilungen, Ordnernamen). */
const S = {
  de: {
    'menu.open': 'SlimKit öffnen …',
    'menu.structure': 'Ordnerstruktur kopieren',
    'menu.rename': 'Viele Dateien umbenennen',
    'menu.images': 'Fotos kleiner machen',
    'menu.send': 'Aufs Handy schicken',
    'menu.receive': 'Fotos vom Handy holen',
    'menu.dates': 'Datum von Fotos reparieren',
    'menu.sort': 'Fotos nach Datum ordnen',
    'menu.pdf': 'Aus Fotos eine PDF machen',
    'kind.image': 'Bilder',
    'kind.video': 'Videos',
    'kind.audio': 'Musik',
    'kind.doc': 'Dokumente',
    'kind.archive': 'Archive',
    'kind.app': 'Programme',
    'kind.other': 'Sonstiges',
    'tray.open': 'SlimKit öffnen',
    'tray.auto': 'Automatik läuft',
    'tray.quit': 'Beenden',
    'auto.log.year': 'Neues Jahr: „{name}“ angelegt',
    'auto.log.tidy': '„{name}“ aufgeräumt ({n} Dateien)',
    'auto.log.cleanup': '{n} alte Dateien aus „{name}“ in den Papierkorb',
    'auto.notify.year.title': 'Willkommen in {year}!',
    'auto.notify.year.body': 'SlimKit hat „{name}“ mit {n} Ordnern angelegt.',
    'received.title': 'Datei empfangen',
    'received.body': '{name} von {device}',
    'pdf.merged': 'Zusammengefügt',
    'pdf.pages': 'Seiten',
    'images.folder': 'Verkleinert',
    'list.name': 'Name',
    'list.folder': 'Ordner',
    'list.size': 'Größe (Bytes)',
    'list.modified': 'Geändert',
    'list.type': 'Typ',
    'list.file': 'Dateiliste',
  },
  en: {
    'menu.open': 'Open SlimKit …',
    'menu.structure': 'Copy folder structure',
    'menu.rename': 'Rename many files',
    'menu.images': 'Make photos smaller',
    'menu.send': 'Send to your phone',
    'menu.receive': 'Get photos from your phone',
    'menu.dates': 'Fix the date of photos',
    'menu.sort': 'Sort photos by date',
    'menu.pdf': 'Turn photos into a PDF',
    'kind.image': 'Images',
    'kind.video': 'Videos',
    'kind.audio': 'Music',
    'kind.doc': 'Documents',
    'kind.archive': 'Archives',
    'kind.app': 'Installers',
    'kind.other': 'Other',
    'tray.open': 'Open SlimKit',
    'tray.auto': 'Automations running',
    'tray.quit': 'Quit',
    'auto.log.year': 'New year: created “{name}”',
    'auto.log.tidy': 'Tidied “{name}” ({n} files)',
    'auto.log.cleanup': 'Moved {n} old files from “{name}” to the trash',
    'auto.notify.year.title': 'Welcome to {year}!',
    'auto.notify.year.body': 'SlimKit created “{name}” with {n} folders.',
    'received.title': 'File received',
    'received.body': '{name} from {device}',
    'pdf.merged': 'Combined',
    'pdf.pages': 'pages',
    'images.folder': 'Resized',
    'list.name': 'Name',
    'list.folder': 'Folder',
    'list.size': 'Size (bytes)',
    'list.modified': 'Modified',
    'list.type': 'Type',
    'list.file': 'File list',
  },
};

function makeT(getLang) {
  return (key, params) => {
    const lang = S[getLang()] ? getLang() : 'en';
    let s = S[lang][key] ?? S.en[key] ?? key;
    if (params) for (const k in params) s = s.split(`{${k}}`).join(String(params[k]));
    return s;
  };
}
function kindNames(t) {
  return Object.fromEntries(['image', 'video', 'audio', 'doc', 'archive', 'app', 'other'].map((k) => [k, t('kind.' + k)]));
}

module.exports = { makeT, kindNames, STRINGS: S };
