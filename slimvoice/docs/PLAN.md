# Plan – SlimVoice

## Name

**SlimVoice**: passt zur Marke (SlimKit, SlimClick, SlimSort …), „Voice“ sagt sofort, worum es geht.
Vor der Veröffentlichung kurz im DPMA-Register (`register.dpma.de`) nach „SlimVoice“ für Software suchen.

## Was es schon gibt und was SlimVoice besser macht

| Tool | Wie | Schwäche |
|---|---|---|
| Windows-Diktat (Win+H), Mac-Diktierfunktion | eingebaut | ungenau, bricht beim Tippen ab, keine Fachbegriffe |
| Gboard / Samsung-Tastatur | Handy | nur Handy, ungenau |
| Wispr Flow | App, Cloud | Abo (~15 $/Monat), Konto nötig, alles geht in die Cloud |
| Superwhisper | Mac-App, lokal | nur Mac, Pro-Funktionen kosten Geld |
| MacWhisper | Mac-App | nur Mac, eher für Dateien als zum Diktieren in jede App |
| Windows-Tools (Buzz u. a.) | Transkription | kein Diktieren direkt an den Cursor, kompliziert |

**SlimVoice:**
- Windows **und** Mac, komplett kostenlos, ohne Konto.
- Lokal und privat (whisper.cpp) **oder** über Online-Dienste mit eigenem Schlüssel und Schritt-für-Schritt-Anleitung.
- Eigene **Wörter und Ersetzungen pro Programm**, KI-Korrektur in Stufen, Befehlsmodus.
- Klein (Tauri statt Electron), Einfach- und Expertenmodus.

## Version 1.0

- Ein Tastenkürzel: halten = sprechen, kurz tippen = freihändig. Man kann nebenher tippen.
- Drei Modi: sofort einfügen, Live-Vorschau, erst aufnehmen.
- Lokale Erkennung mit whisper.cpp:
  - Modelle Klein (~60 MB), Mittel (~190 MB) und Groß (~575 MB), erst bei Bedarf heruntergeladen.
  - Nach dem Download prüft ein eingebauter Selbsttest die Erkennung mit einer Sprachprobe. Klappt es mit der
    Grafikbeschleunigung nicht, nimmt SlimVoice automatisch den Prozessor.
- Online: Groq, OpenAI, Gemini; Claude für die KI-Korrektur; eigener Server für Profis.
- KI-Korrektur Aus/Satzzeichen/Leicht/Stark, Ton, Übersetzen. Ein Sicherheitsnetz verhindert, dass die KI auf
  eine Frage im Diktat antwortet statt sie zu korrigieren.
- Befehlsmodus: markierten Text per Sprache umschreiben, übersetzen oder zusammenfassen.
- Wörter, Fachbegriffe und Kürzel überall **und pro Programm**, dazu Ersetzungen und eigene KI-Stufe pro Programm.
- Füllwörter weg, Sprachbefehle („neuer Absatz“). Stille wird nie verschickt (keine erfundenen Sätze).
- Einrichtungs-Assistent, der sich seinen Schritt merkt. Mac-Freigabe mit automatischer Prüfung und Hilfe.
- Verlauf, Statistik, Mikrofontest, Einfach-/Expertenmodus, Deutsch/Englisch, hell/dunkel, „Über“ mit SlimBit-Link.

## Später

1. Android-App (eigene App mit schwebendem Mikrofon-Knopf über die Bedienungshilfen, funktioniert mit jeder Tastatur).
2. Echtes Wort-für-Wort-Streaming in der Vorschau.
3. Lokale KI-Korrektur (kleines Sprachmodell auf dem Rechner).
4. Automatische Updates.
5. Weitere Sprachen der Oberfläche (FR, ES, IT).
