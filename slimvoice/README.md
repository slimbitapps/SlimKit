# SlimVoice – dictation that actually works (Windows & Mac)

Hold a shortcut, speak, and clean text appears where your cursor is, **in every app**.
Free · no ads · no account · local & private or via online services.

**Deutsch:** Tastenkürzel halten, sprechen, loslassen, und sauberer Text steht dort, wo dein Cursor ist,
in jedem Programm. Kostenlos, ohne Werbung, ohne Konto. Die Erkennung läuft auf deinem Rechner oder über einen Online-Dienst.

## Funktionen

**Bedienung**
- **Ein Kürzel**, Standard Strg+Umschalt+Leertaste, Mac ⌥Leertaste:
  - **halten** = sprechen, loslassen = fertig
  - **kurz tippen** = freihändig (du kannst nebenher tippen), nochmal drücken = fertig
- **Drei Modi:** sofort einfügen, Live-Vorschau (am Ende in bester Qualität) oder erst aufnehmen.

**Erkennung**
- **Lokal mit whisper.cpp** (wie Superwhisper/MacWhisper), Mac mit Metal-Beschleunigung.
- Drei Modellgrößen, erst bei Bedarf heruntergeladen.
- Danach läuft ein **Selbsttest** mit einer Sprachprobe. Klappt die Grafikbeschleunigung nicht, nimmt SlimVoice automatisch den Prozessor.
- **Online:** Groq (kostenlos testen), OpenAI, Gemini, für die KI-Korrektur auch Claude, mit Schritt-für-Schritt-Anleitung für den Schlüssel.

**Text verbessern**
- **Wörter & Programme:** Fachbegriffe, Namen und Kürzel überall und **pro Programm** (z. B. Outlook, Word, VS Code), dazu Ersetzungen und eine eigene KI-Stufe pro Programm.
- **KI-Korrektur:** Aus / Satzzeichen / Leicht / Stark, Ton (locker/förmlich), Übersetzen.
- **Befehlsmodus** (Alt+Umschalt+Leertaste): Text markieren und z. B. „mach das förmlicher“ sagen.
- Füllwörter entfernen, Sprachbefehle („neuer Absatz“). **Stille wird nie verschickt**, dadurch keine erfundenen Sätze.

**Sonstiges**
- Einrichtungs-Assistent, Einfach-/Expertenmodus, Verlauf, Statistik, Mikrofontest.
- Deutsch/Englisch, hell/dunkel.

## Technik

- **Tauri 2** (Rust) + React/TypeScript/Vite. Die App ist ca. 10–20 MB groß statt über 100 MB mit Electron.
- `src-tauri/src/`:
  - `vad.rs`: Sprechpausen
  - `audio.rs`: Mikrofon
  - `local.rs`: whisper.cpp
  - `providers.rs`: Online-Dienste
  - `session.rs`: Ablauf eines Diktats
  - `inserter.rs`: Einfügen
  - `keyhold.rs`: halten/tippen
  - `lib.rs`: App, Fenster, Kürzel, Infobereich
- `src/settings/`: Einstellungen. `src/overlay/`: Anzeige beim Diktieren.

## Entwickeln

```bash
npm install
```

```bash
npm start
```

Tests in Rust (Text, Sprechpausen, Dienste mit Test-Server, Diktat-Ablauf, Profile):

```bash
npm test
```

Ende-zu-Ende-Test: Er steuert die echte App mit simuliertem Mikrofon und Test-Server und macht Bildschirmfotos.
Unter Linux mit `xvfb-run -a` davor.

```bash
npm run build:web && (cd src-tauri && cargo build --features tauri/custom-protocol) && node test/e2e/run.cjs
```

```bash
npm run build
```

Ein Programm von **SlimBit Apps**: https://slimbitapps.github.io · SlimBitApps@gmail.com
