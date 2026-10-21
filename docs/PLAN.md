# Plan – SlimKit

## Name

**SlimKit** – „Kit“ = Werkzeugkasten, passt zur Marke (Slim…). Kurz, international verständlich.
Vor der Veröffentlichung kurz im DPMA-Register (`register.dpma.de`) nach „SlimKit“ für Software suchen.

## Idee

Die fehlenden Rechtsklick-Werkzeuge für Finder (Mac) und Explorer (Windows): Dateien/Ordner markieren →
Rechtsklick → **SlimKit** → ein kleines Fenster zeigt passende Schnellaktionen.

## Was es schon gibt – und was SlimKit besser macht

| Tool | Wie | Schwäche |
|---|---|---|
| xcopy /T /E, rsync | Befehle im Terminal | Für normale Nutzer unbrauchbar, kein Jahr-Ersetzen |
| Copywhiz, Beyond Compare | Programme | Kostenpflichtig, nur Windows bzw. teuer |
| FileMenu Tools | Explorer-Erweiterung | Nur Windows, gratis nur bis 20 Dateien, Adware im Installer |
| PowerToys (PowerRename, Image Resizer) | Microsoft-Werkzeugsammlung | Nur Windows, kein Ordnerstruktur-Kopieren, keine Übertragung |
| Path Finder, ForkLift | Finder-Ersatz | Kostenpflichtig, ersetzt den Finder statt ihn zu ergänzen |
| LocalSend, Snapdrop/PairDrop | Datei-Übertragung | App auf beiden Geräten bzw. Internet-Server nötig |

**SlimKit:** Windows **und** Mac, komplett kostenlos ohne Grenzen, alles in einem Rechtsklick,
**Rückgängig** für fast jede Aktion, Übertragung per QR-Code ohne App und ohne Internet,
Automatik („jedes Jahr die Ordnerstruktur fortführen“), Einfach- und Expertenmodus.

## Version 1.0 (13 Werkzeuge – bewusst nur, was Finder und Explorer nicht können)

**Ordner**
- Ordnerstruktur kopieren (ohne Dateien) – Jahreszahl wird automatisch ersetzt (2025 → 2026),
  wahlweise bestimmte Dateitypen mitnehmen (z. B. Vorlagen), in vorhandenen Ordner ergänzen
- Strukturen als Vorlage speichern und überall anlegen
- Nach Datum oder Typ in Unterordner sortieren · Ordner auflösen · Leere Ordner entfernen
- Ordnergröße und größte Dateien · Dateiliste exportieren (CSV/Text)

**Dateien**
- Mehrere umbenennen (Nummerieren, Text ersetzen, Datum voranstellen, Groß/klein, Vorlage mit Platzhaltern)
- Datum ändern (festes Datum, Aufnahmedatum aus Foto/Video, aus dem Dateinamen, Zeitverschiebung)
- Doppelte Dateien finden

**Bilder & PDF**
- Bilder verkleinern / vergrößern / umwandeln (JPG, PNG, WebP; Zielgröße in KB; entfernt Standortdaten)
- Bilder und PDFs zu einer PDF zusammenfügen · PDF in Seiten aufteilen

**Übertragen (ohne App, ohne Internet)**
- Auf anderes Gerät senden: QR-Code scannen → Dateien laden (einzeln oder als ZIP)
- Von anderem Gerät empfangen: QR-Code scannen → Fotos/Dateien am Handy auswählen → landen im Ordner

**Automatik** (läuft im Hintergrund, Symbol in der Menüleiste/Taskleiste)
- Neues Jahr: Ordnerstruktur des Vorjahres zum Stichtag fortführen
- Ordner aufräumen: neue Dateien automatisch nach Typ oder Datum einsortieren (z. B. Downloads)
- Alte Dateien in den Papierkorb (z. B. Downloads älter als 30 Tage)

**Allgemein**
- Rechtsklick-Menü: Mac „Schnellaktionen“, Windows Kontextmenü + „Senden an“ – mit einem Klick ein-/ausschalten
- Verlauf mit Rückgängig · Englisch & Deutsch · hell/dunkel · Einfach/Experte · Einführung beim ersten Start

## Später (Version 2)

1. Windows-11-Hauptmenü (ohne „Weitere Optionen“) – braucht ein signiertes Paket (MSIX), erst mit Zertifikat
2. Videos verkleinern (ffmpeg, große Datei → daher als optionaler Download)
3. Ordner vergleichen und angleichen (zwei Ordner, Unterschiede anzeigen)
4. Bilder drehen/zuschneiden, Wasserzeichen
5. Mehr Sprachen (Französisch, Spanisch, Italienisch)
6. „Ordner-Farben“ und Tags gemeinsam für Windows und Mac
7. Übertragung zwischen zwei Computern mit SlimKit in beide Richtungen gleichzeitig
