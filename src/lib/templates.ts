import { getLang } from '../i18n';

/** Fertige Ordner-Vorlagen für alle, die noch keine eigene Struktur haben. {y} = Jahr, {n} = nächstes Jahr */
export type BuiltIn = { id: string; name: string; dirs: string[]; color: string };

const MONTHS = {
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

export function builtInTemplates(year = new Date().getFullYear()): BuiltIn[] {
  const de = getLang() === 'de';
  const m = de ? MONTHS.de : MONTHS.en;
  const fill = (s: string) => s.split('{y}').join(String(year)).split('{n}').join(String(year + 1));
  const list: BuiltIn[] = de
    ? [
        { id: 'school', color: '#6366f1', name: 'Schuljahr {y}-{n}', dirs: ['Deutsch', 'Mathe', 'Englisch', 'Biologie', 'Geschichte', 'Physik', 'Chemie', 'Erdkunde', 'Kunst', 'Musik', 'Sport', 'Stundenplan & Termine'] },
        { id: 'photos', color: '#f97316', name: 'Fotos {y}', dirs: m.map((x, i) => `{y}-${String(i + 1).padStart(2, '0')} ${x}`) },
        { id: 'papers', color: '#0ea5e9', name: 'Unterlagen {y}', dirs: ['Rechnungen', 'Verträge', 'Versicherungen', 'Bank', 'Steuer', 'Gesundheit', 'Auto', 'Garantien & Belege'] },
        { id: 'project', color: '#14b8a6', name: 'Neues Projekt', dirs: ['01 Planung', '02 Dokumente', '03 Bilder', '04 Entwürfe', '05 Fertig', 'Archiv'] },
        { id: 'client', color: '#a855f7', name: 'Kunde', dirs: ['Angebote', 'Aufträge', 'Rechnungen', 'Schriftverkehr', 'Dateien vom Kunden', 'Fertige Arbeiten'] },
        { id: 'video', color: '#ef4444', name: 'Video-Projekt', dirs: ['Aufnahmen', 'Audio', 'Musik', 'Grafiken', 'Schnitt', 'Export'] },
      ]
    : [
        { id: 'school', color: '#6366f1', name: 'School year {y}-{n}', dirs: ['English', 'Maths', 'Science', 'History', 'Geography', 'Languages', 'Art', 'Music', 'PE', 'Timetable & dates'] },
        { id: 'photos', color: '#f97316', name: 'Photos {y}', dirs: m.map((x, i) => `{y}-${String(i + 1).padStart(2, '0')} ${x}`) },
        { id: 'papers', color: '#0ea5e9', name: 'Paperwork {y}', dirs: ['Bills', 'Contracts', 'Insurance', 'Bank', 'Taxes', 'Health', 'Car', 'Warranties & receipts'] },
        { id: 'project', color: '#14b8a6', name: 'New project', dirs: ['01 Planning', '02 Documents', '03 Images', '04 Drafts', '05 Final', 'Archive'] },
        { id: 'client', color: '#a855f7', name: 'Client', dirs: ['Quotes', 'Orders', 'Invoices', 'Correspondence', 'Files from client', 'Delivered work'] },
        { id: 'video', color: '#ef4444', name: 'Video project', dirs: ['Footage', 'Audio', 'Music', 'Graphics', 'Edit', 'Export'] },
      ];
  return list.map((x) => ({ ...x, name: fill(x.name), dirs: x.dirs.map(fill) }));
}
