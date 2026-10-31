# SlimVoice – Diktieren, das wirklich funktioniert (Windows & Mac)

Tastenkürzel drücken (Standard: **Strg+Umschalt+Leertaste** bzw. **⌘⇧Leertaste**), sprechen, und sauberer Text
landet dort, wo der Cursor steht, in **jeder** App. Die Anzeige nimmt nie den Fokus. Deshalb kannst du
**während des Diktats ganz normal weitertippen**, ohne dass das Diktat abbricht.

> Arbeitsname, Version 0.1 (erster lauffähiger Stand). Liegt vorerst als Unterordner im SlimKit-Repo
> und kann jederzeit in ein eigenes Repo umziehen.

## Was es kann

**Drei Arten zu starten**
- **Taste halten** (Standard: rechte Strg-Taste, Mac: rechte ⌘-Taste): Halten = sprechen, loslassen = fertig.
  Kurz tippen = freihändig, nochmal tippen = fertig. Tastenkombinationen wie rechte Strg+C lösen nichts aus.
- **Tastenkürzel** Strg+Umschalt+Leertaste (Mac: ⌘⇧Leertaste) zum Starten und Beenden.
- **Befehlsmodus** (Alt+Umschalt+Leertaste): Text markieren und sagen, was passieren soll, z. B. „mach das förmlicher“,
  „übersetze ins Englische“ oder „fasse in drei Punkten zusammen“. Die KI ersetzt die Markierung.
  Ohne Markierung schreibt sie neuen Text („schreib eine kurze Absage für morgen“).

**Einrichtungs-Assistent** beim ersten Start: Du wählst, ob die Erkennung **auf deinem Computer** läuft
(kostenlos, privat, offline, ohne Konto) oder **über einen Online-Dienst** (am schnellsten). Für jeden Dienst
gibt es eine Schritt-für-Schritt-Anleitung, wie du an den API-Schlüssel kommst. Der Schlüssel wird beim Einfügen sofort geprüft.

**Lokale Spracherkennung** (Whisper, direkt in der App), wird erst bei Bedarf heruntergeladen:
- Klein (ca. 80 MB), Mittel (ca. 250 MB) oder Groß (ca. 900 MB).
- SlimVoice empfiehlt eine passende Größe für deinen Rechner.
- Rechnet auf der Grafikkarte, wenn möglich, sonst auf dem Prozessor mit mehreren Kernen.
- Danach funktioniert alles ohne Internet.

**Drei Modi** (auch über das Symbol umschaltbar)
- **Sofort einfügen**: Nach jeder Sprechpause wird der Satz eingefügt. Am schnellsten.
- **Live-Vorschau** (Standard): Du siehst mit, was erkannt wird. Am Ende wird alles in bester Qualität
  umgewandelt und einmal eingefügt.
- **Erst aufnehmen**: Ohne Vorschau. Am Ende wird die ganze Aufnahme umgewandelt, günstig und genau.

**Tempo oder Qualität**: Schnell / Ausgewogen / Beste Qualität. Damit werden die Modelle und die Pausenlänge gewählt.
Unter „Expertenoptionen“ lässt sich jedes Modell einzeln festlegen.

**KI-Korrektur in vier Stufen**
- Aus
- Nur Satzzeichen
- Leicht: Grammatik und falsch verstandene Wörter werden aus dem Zusammenhang korrigiert. Ergibt ein Satz
  keinen Sinn, wird er minimal repariert.
- Stark: wird sauber umformuliert, Selbstkorrekturen („um drei, nein, um vier“) werden aufgelöst.

Dazu:
- Ton (wie gesprochen, locker, förmlich)
- Übersetzen beim Diktieren
- eigene Anweisung an die KI
- Kontext: der vorherige Text wird mitgegeben
- **Sicherheitsnetz**: Antwortet die KI auf eine Frage im Diktat, statt sie zu korrigieren, wird der Originaltext eingefügt.

**Ohne KI, immer lokal**
- Füllwörter entfernen („äh“, „ähm“)
- Sprachbefehle („neue Zeile“, „neuer Absatz“)
- eigene Ersetzungen („mfg“ → „Mit freundlichen Grüßen“)
- Filter gegen typische Whisper-Halluzinationen in Stille („Untertitel im Auftrag des ZDF“ …)

**Eigenes Wörterbuch** für Namen und Fachbegriffe. Es geht an die Spracherkennung und an die KI.

**App-Profile**: z. B. in Outlook förmlich, in Slack locker und nur Satzzeichen.

**Online-Dienste**: Groq (kostenlos testen), OpenAI, Google Gemini, Anthropic Claude (nur Korrektur) oder für Profis ein **eigener Server**
(OpenAI-kompatibel, z. B. speaches/faster-whisper und Ollama). Damit geht es auch ganz ohne Cloud.
- API-Schlüssel werden mit dem System verschlüsselt (Windows DPAPI, Mac-Schlüsselbund).
- „Verbindung testen“ prüft Schlüssel, Adresse und Modell.

**Weiteres**
- **Stille wird nie verschickt**: Die Sprechpausen-Erkennung schneidet sie heraus. Das spart Kosten und verhindert Halluzinationen.
- Lange Aufnahmen werden automatisch an Sprechpausen in passende Stücke geteilt.
- **Verlauf**, damit kein Diktat verloren geht. Bei einem Fehler liegt der Text in der Zwischenablage.
- Einfügen über die Zwischenablage (danach wiederhergestellt), per simulierten Tastendrücken oder nur kopieren.
- Mikrofonwahl, Empfindlichkeit, Pausenlänge, Rauschunterdrückung, Töne, Anzeige oben/unten, maximale Länge,
  Autostart, Deutsch/Englisch, hell/dunkel.

## Wie es technisch funktioniert

| | Windows | Mac |
|---|---|---|
| Läuft als | Symbol im Infobereich | Symbol in der Menüleiste (kein Dock-Symbol) |
| Tastenkürzel | global (Electron `globalShortcut`) | global |
| Text einfügen | kleines PowerShell-Hilfsprogramm mit `SendInput`; bleibt offen, also schnell | AppleScript über „System Events“; braucht die Freigabe **Bedienungshilfen** |
| App im Vordergrund (für Profile) | `GetForegroundWindow` | System Events |

Ablauf:
1. Das Overlay nimmt mit 16 kHz auf.
2. Es erkennt Sprechpausen am Grundrauschpegel und schickt nur die Sprachabschnitte an den Hauptprozess.
3. `electron/core/session.cjs` entscheidet je nach Modus, was wann umgewandelt, korrigiert und eingefügt wird.

## Entwickeln

```bash
npm install
```

```bash
npm start
```

```bash
npm test
```

Ende-zu-Ende-Test: Er startet die echte App mit simuliertem Mikrofon und einem Test-Server und macht Screenshots.
Unter Linux ohne Bildschirm mit `xvfb-run -a` davor.

```bash
npm run test:e2e
```

```bash
npm run icons
```

```bash
npm run dist:win
```

```bash
npm run dist:mac
```

## Bekannte Grenzen / nächste Schritte

- **Echtes Wort-für-Wort-Streaming** (Realtime-APIs per WebSocket) wäre der nächste Schritt für die Vorschau.
  Aktuell aktualisiert sie sich satzweise nach jeder Pause.
- Lokale KI-Korrektur (kleines Sprachmodell auf dem Rechner). Bisher braucht die Korrektur einen Online-Dienst.
  Ohne Dienst wird sie einfach übersprungen.
- Code-Signatur: Mac (Developer ID + Notarisierung) und Windows (sonst SmartScreen-Warnung) vor der Veröffentlichung.
- Die Modellnamen der Anbieter ändern sich häufig. Die Voreinstellungen in `electron/core/providers.cjs` vor dem
  Release prüfen; in der App sind sie jederzeit überschreibbar.
- Android (APK) folgt als eigene App: schwebender Mikrofon-Knopf über Bedienungshilfen, damit es mit jeder Tastatur funktioniert.
