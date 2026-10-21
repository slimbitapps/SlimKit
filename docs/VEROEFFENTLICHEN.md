# Veröffentlichen & bekannt machen – SlimKit

Von oben nach unten abhaken. Alles ist kostenlos. Texte zum Kopieren: **[STORE-TEXTE.md](STORE-TEXTE.md)**.

> ⚠️ **Alter:** Viele Seiten verlangen ein Mindestalter (meist 13, manche 16 oder 18). Vor dem Anmelden in den
> Nutzungsbedingungen nachsehen. Wo 18 verlangt wird (z. B. Product Hunt, Microsoft Store mit Ausweis), nur gemeinsam mit deinen Eltern.

---

## Teil A – Online stellen (erledigt Claude mit `bash scripts/publish.sh`)

- ✅ Repository **slimbitapps/SlimKit** angelegt und hochgeladen
- ✅ GitHub Pages eingeschaltet → **https://slimbitapps.github.io/SlimKit/**
- ✅ Installer über GitHub Actions gebaut, Release **v1.0.0** mit 4 Dateien:
  `SlimKit-Setup.exe`, `SlimKit-Windows-portable.zip`, `SlimKit-Mac.dmg`, `SlimKit-Mac-Intel.dmg`
- ✅ Beschreibung, Website und Stichwörter (Topics) des Repositorys gesetzt
- ✅ Startseite **slimbitapps.github.io** mit SlimKit-Karte, Sitemap und llms.txt

### ☐ A1. Suchmaschinen Bescheid geben (5 Minuten, nur du)
1. **Google Search Console** (`search.google.com/search-console`) → Property `https://slimbitapps.github.io/` →
   links **Sitemaps** → `sitemap.xml` → **Senden**.
   Dann oben in die Suchleiste `https://slimbitapps.github.io/SlimKit/` eingeben → **Indexierung beantragen**.
2. **Bing Webmaster Tools** (`bing.com/webmasters`) → deine Website → **Sitemaps** → **Sitemap einreichen** →
   `https://slimbitapps.github.io/sitemap.xml`. Bing ist die Suche hinter **ChatGPT** – wichtig für KI-Empfehlungen.

---

## Teil B – Kostenlos eintragen (Reihenfolge nach Nutzen)

| # | Wo | Für wen | Aufwand |
|---|---|---|---|
| B1 | AlternativeTo | Leute suchen gezielt Alternativen | 10 Min. |
| B2 | heise Download, CHIP, Computerbild, Netzwelt | Deutschland, viele Besucher | je 10 Min. |
| B3 | Softpedia, Uptodown, MajorGeeks, MacUpdate | international | je 10 Min. |
| B4 | Reddit | Mac-/Windows-Fans, Schüler | je 5 Min. |
| B5 | Deutsche Foren | Technik-Fans | je 5 Min. |
| B6 | SourceForge (spiegelt GitHub) | zusätzliche Downloads | 10 Min. |

### ☐ B1. AlternativeTo
1. `alternativeto.net` → **Sign up** (mit SlimBitApps@gmail.com).
2. Oben **+ Add app** → Name `SlimKit`, Website `https://slimbitapps.github.io/SlimKit/`.
3. Beschreibung: **Short description** (Englisch) aus STORE-TEXTE.md. Plattformen: Windows, Mac. Lizenz: **Free**.
4. Logo: `brand/logo-square.png` · Screenshots: `marketing/screenshots/en-1-hero.png`, `en-2-structure.png`, `en-6-send.png`.
5. Bei **„Alternative to“**: *FileMenu Tools*, *PowerToys*, *Copywhiz*, *LocalSend*, *Snapdrop*, *Bulk Rename Utility*, *Path Finder*.
6. Tags: `folder-structure`, `batch-rename`, `image-resizer`, `file-transfer`, `context-menu`.

### ☐ B2. Deutsche Download-Portale
Bei Google suchen: `<Portal> Software einreichen` (z. B. „heise download software einreichen“). Formular so ausfüllen:
- Name `SlimKit`, Version `1.0.0`, **Kurzbeschreibung** + **Beschreibung** (Deutsch) aus STORE-TEXTE.md
- Download-Link: **`https://slimbitapps.github.io/SlimKit/`**
- Lizenz Freeware · Windows 10/11, macOS 12+ · Screenshots `de-1-hero.png`, `de-2-structure.png`, `de-5-images.png`
- ⚠️ **Nein** sagen zu „Download-Manager“, „Installer-Wrapper“ oder Werbung im Installer.

### ☐ B3. Englische Portale
Gleich wie B2 mit den englischen Texten: **Softpedia** („Submit program“), **Uptodown** („Upload app“),
**MajorGeeks** („Submit“), **MacUpdate** („Submit an app“, nur Mac-Version).

### ☐ B4. Reddit
Vorher **Regeln der Gruppe lesen** (rechte Spalte). Pro Gruppe **ein** Beitrag, nicht alles am selben Tag.
Bild dazu: `en-2-structure.png` (bzw. `de-2-structure.png`).

| Gruppe | Hinweis |
|---|---|
| r/macapps | Titel mit „[Free]“ beginnen |
| r/software | allgemeine Programm-Vorstellungen |
| r/windows | nur wenn Eigenwerbung erlaubt ist (Regeln!) |
| r/SideProject | eigene Projekte ausdrücklich erwünscht |
| r/DataHoarder | Fokus „Ordnerstruktur kopieren, Duplikate“ |
| r/de_EDV | auf Deutsch |

**Vorlage (Englisch):**
```
[Free] I built a small app that adds the missing right-click tools to Finder & Explorer

Every January I wanted the same folder structure as last year ("Photos 2025" with all its subfolders) – but without copying thousands of photos. Neither Finder nor Explorer can do that, so I built SlimKit.

Right-click a folder → SlimKit → Copy folder structure: it copies only the folders and replaces the year in every folder name (2025 → 2026). It can even do that by itself every 1 January.

It also has a few other things I kept missing:
- make photos smaller by purpose (email, WhatsApp, forms with max 1 MB)
- rename many files with a live preview
- send files to your phone (or get photos from it) via QR code – no app on the phone, only your own Wi-Fi
- fix photo dates, sort photos by month, photos → PDF
- everything shows a preview and can be undone

Windows & Mac, free, no ads, no account: https://slimbitapps.github.io/SlimKit/
I'm a student and this is a hobby project – feedback very welcome!
```

**Vorlage (Deutsch, für r/de_EDV):**
```
[Kostenlos] Ich habe eine App gebaut, die Finder und Explorer die fehlenden Rechtsklick-Werkzeuge gibt

Jedes Jahr im Januar wollte ich dieselbe Ordnerstruktur wie im Vorjahr („Fotos 2025“ mit allen Unterordnern) – aber ohne Tausende Fotos mitzukopieren. Das können weder Finder noch Explorer, also habe ich SlimKit gebaut.

Rechtsklick auf den Ordner → SlimKit → Ordnerstruktur kopieren: Es kopiert nur die Ordner und ersetzt die Jahreszahl in allen Ordnernamen (2025 → 2026). Auf Wunsch macht es das jeden 1. Januar von selbst.

Dazu ein paar Dinge, die mir immer gefehlt haben:
- Fotos verkleinern nach Zweck (E-Mail, WhatsApp, Formulare mit max. 1 MB)
- viele Dateien umbenennen mit Vorschau
- Dateien per QR-Code aufs Handy schicken (oder Fotos vom Handy holen) – ohne App, nur im eigenen WLAN
- Fotodatum reparieren, Fotos nach Monat sortieren, Fotos → PDF
- alles mit Vorschau und rückgängig machbar

Windows & Mac, kostenlos, ohne Werbung, ohne Konto: https://slimbitapps.github.io/SlimKit/
Ich bin Schüler und das ist ein Hobbyprojekt – Feedback ist sehr willkommen!
```

### ☐ B5. Deutsche Foren
Im Bereich „Software“ / „Programmvorstellungen“, Text wie die deutsche Reddit-Vorlage:
- **ComputerBase-Forum** → Software → Programmvorstellungen
- **Dr. Windows** → Software
- **MacUser.de** → Software
- **Deskmodder** → Software-Tipps

### ☐ B6. SourceForge
1. `sourceforge.net` → **Create** → **Import project from GitHub** → `slimbitapps/SlimKit`.
2. Neue Releases werden dann automatisch übernommen.

---

## Teil C – Später (optional)
- ☐ **YouTube-Short (30 Sek.):** „Ordnerstruktur fürs neue Jahr – in 5 Sekunden“ (Rechtsklick → fertig).
- ☐ **Microsoft Store:** braucht einen Ausweis einer volljährigen Person → mit deinen Eltern.
- ☐ **Windows-11-Hauptmenü** (ohne „Weitere Optionen anzeigen“): geht erst mit signiertem Paket.

## Deine nächsten 3 Schritte
1. ☐ A1: Sitemap bei Google und Bing einreichen
2. ☐ B1: AlternativeTo
3. ☐ B4: r/macapps und r/de_EDV (an verschiedenen Tagen)
