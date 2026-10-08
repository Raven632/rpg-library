# 🎮 RPG Library v6.0

🇬🇧 [English](README.md) | 🇷🇺 [Русский](README.ru.md)

[![GitHub Release](https://img.shields.io/github/v/release/Raven632/rpg-library?style=for-the-badge&color=blue)](https://github.com/Raven632/rpg-library/releases)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-yellow.svg?style=for-the-badge)](LICENSE)
![Tests: Passing](https://img.shields.io/badge/Tests-69_unit_%2B_game_compatibility-brightgreen?style=for-the-badge&logo=jest&logoColor=white)

![Node.js](https://img.shields.io/badge/Node.js-22.x-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)

Eine eigene Web-Bibliothek für RPG-Maker-Spiele (MV/MZ): die Spiele liegen auf dem Heimserver, gespielt
wird im Browser auf Handy, Tablet oder PC, und alles über die Spiele findet der Server selbst.

![Die Bibliothek — eine Demo-Sammlung erfundener Spiele](rest/img/library.png)

<p align="center">
  <img src="rest/img/game.png" alt="Das Spielfenster" width="70%">
  <img src="rest/img/mobile.png" alt="Auf dem Handy" width="24%">
</p>

## ✨ Funktionen

### Spielen

- **In jedem Browser.** `rpg-fixes.js` ersetzt NW.js, deshalb laufen die PC-Versionen von
  RPG-Maker-Spielen auch auf dem Handy: Ton auf dem iPhone, Videos, Schriften, Ordner in beliebiger
  Groß- und Kleinschreibung.
- **Cloud-Spielstände mit Verlauf.** Spielstände liegen auf dem Server — am PC anfangen, am Handy
  weiterspielen. Ein überschriebener Slot bleibt eine Weile erhalten, und „Spielstand-Verlauf“ holt
  jede Version zurück; ein ohne Netz gespeicherter Stand überschreibt keinen neueren von einem anderen
  Gerät.
- **Menü im Spiel:** Turbo ×3, Cheat-Menü, Speichern überall auf der Karte, Bildschirm-Gamepad und
  -Tastatur, echtes Gamepad, Strecken und Glätten, Bildzähler.
- **Spiele laufen unter eigener Adresse**, getrennt von der Bibliothek: der Code eines Spiels erreicht
  weder die Daten der Bibliothek noch fremde Seiten.

### Bibliothek

- **Daten finden sich selbst** — von itch.io, VNDB und Steam: Cover, Screenshots, Beschreibung, Tags,
  Entwickler, Erscheinungsdatum. Jeder Treffer wird mit allen Namen des Spiels abgeglichen.
- **Eine Galerie aus den Dateien des Spiels** — CG, Figuren, Hintergründe in Alben, Bilder als
  Animation abspielbar, ohne das Spiel zu spielen.
- **Status setzen sich selbst** („Spiele gerade“, „Nicht begonnen“), und **„Was spielen?“** schlägt
  ein noch nicht angefangenes Spiel vor, nach Genre.
- **Neue Spiele** aus dem itch.io-Katalog — nach Tag, Zeitraum, Preis und Plattform — mit einer
  „Will ich spielen“-Liste und einer Markierung für Spiele, die schon da sind.
- **Statistik und Prüfung**: Spielzeit, Lücken in den Daten, Duplikate, schwere Spiele, Fehler, auf die
  Spiele auf deinen Geräten stoßen.

### Hochladen

- **Jede Größe, auch vom Handy.** Ein abgebrochener Upload geht an derselben Stelle weiter — nach dem
  Neuladen oder von einem anderen Gerät. Archive mit Passwort, ein Spiel in einem Archiv im Archiv.
- **Ein Spiel mit seiner neuen Version aktualisieren** — Spielstände, Zeit und Daten bleiben; **einen
  Patch oder Mod installieren** (Englisch-Patch, Walkthrough-Mod). Die vorige Version wird beiseitegelegt
  und kommt mit einem Knopf zurück.

### Benachrichtigungen und Sicherheit

- **Telegram** (optional, eigener Bot): fertige Uploads, einmal am Tag eine Sicherung von Datenbank und
  Spielständen, wenn sich etwas geändert hat, Probleme. Alles außer Problemen lautlos, höchstens zehn
  Nachrichten pro Stunde.
- **Sicherung** von Datenbank und Spielständen aus dem Menü; eine nächtliche Sicherung auf dem Server.
- **Abgesichert:** Anmeldeversuche begrenzt, die API antwortet nur den Seiten der Bibliothek, eine
  Sicherungsdatei enthält keinen Anmeldeschlüssel, ein Deploy, der nicht hochkommt, wird zurückgerollt.
- **Oberfläche** auf Deutsch, Englisch und Russisch; Cover mit einem Knopf ausblenden; Änderungen sofort
  auf allen Geräten.

## 🧩 Unter der Haube

- **Isolierte Spiele.** Spiele kommen von einem eigenen Origin (`GAME_PORT`). Seine Dateien und
  Spielstände bekommt ein Spiel nur über einen Schlüssel in seiner Adresse — ein HMAC aus dem
  Sitzungsgeheimnis, dem Spiel und seinem Ordner —, Abmelden oder Ersetzen des Spiels ändert ihn. Eine
  Content-Security-Policy hält den Code des Spiels von fremden Seiten fern, und die API der Bibliothek
  prüft Fetch Metadata (`Sec-Fetch-Site`), sodass auch sie für das Spiel unerreichbar ist. Die
  Bibliothek öffnet das Spiel bildschirmfüllend in einem Frame mit `sandbox` und spricht mit ihm über
  `postMessage`.
- **NW.js im Browser.** `api/public/rpg-fixes.js` gibt PC-Versionen, was sie von NW.js erwarten:
  Ersatz für `fs` und `path` aus Node, einen eigenen `localStorage`-Bereich je Spiel, Cloud-Spielstände
  mit Offline-Warteschlange und Konfliktprüfung, ein Touch-Gamepad, die Ton-Freigabe auf iOS und
  Fehlerberichte an den Server.
- **Fortsetzbare Uploads.** Archive gehen in Stücken passend zur Verbindung (16–256 MB) hoch und
  werden über einen Fingerabdruck der Datei — Name, Größe und ein Hash des ersten und letzten
  Megabytes — nach dem Neuladen oder von einem anderen Gerät fortgesetzt. Das Entpacken läuft im
  Hintergrund und wird nach einem Neustart des Servers zu Ende geführt. Auf iOS kommt die Antwort auf
  eine große Anfrage nie an, deshalb bestätigt die Seite jedes Stück über eine kurze Statusabfrage.
- **Spielstände.** Atomares Schreiben (temporäre Datei + rename), ein ausgedünnter Verlauf je Slot
  (die letzten fünf, dann einer pro 10 Minuten, höchstens 30) und eine Konfliktprüfung über die
  Speicherzeit des Geräts.
- **Updates und Patches ohne Kopien.** Ein Patch wird auf eine Kopie des Spiels aus harten Links
  (`cp -al`) gelegt; geänderte Dateien werden erst entkoppelt und dann ersetzt, sodass die vorige
  Version ihre eigenen behält. Wohin die Dateien eines Patches gehören, findet der Server durch
  Abgleich mit den Dateien des Spiels, ohne Groß- und Kleinschreibung.
- **Galerie-Verzeichnis.** Von jedem Bild werden nur die ersten 40 Bytes gelesen: PNG `IHDR`, WebP
  `VP8`/`VP8L`/`VP8X` und die verschlüsselten Header von RPG Maker liefern die Größe; Größe und
  Bytedichte sortieren die Bilder in CG, Figuren, Hintergründe und Ebenen, die Namen fassen Bilder zu
  Alben zusammen. Vorschaubilder sind WebP, einmal von FFmpeg erzeugt.
- **Datensuche.** Jede Suche merkt sich, welche Quellen nicht geantwortet haben (`AsyncLocalStorage`),
  sodass „nicht gefunden“ und „nicht erreichbar“ verschiedene Ergebnisse mit eigenem Wiederholplan
  sind; Titel werden bereinigt und mit dem Dice-Koeffizienten verglichen; Anfragen an ScraperAPI sind
  durch ein Tageskontingent begrenzt.
- **Betrieb.** Docker Compose; ein Pull-Deploy mit Gesundheitsprüfung und Rückkehr zum vorigen Image;
  nächtliche Sicherungen; Meldungen per Telegram; die CI lässt Tests und Build laufen und setzt dann
  den Branch `deploy`, dem der Server folgt.
- **Tests.** Der Test-Runner von Node, ohne Netz: Quellen sind ersetzt, Uploads und der Spielserver
  laufen auf echten HTTP-Servern auf freien Ports. Ein Playwright-Check öffnet jedes Spiel einer
  Bibliothek in headless Chromium und meldet die erreichte Szene.

## 🛠 Technik

- **Server:** Node.js 22, Express, Socket.io, Redis (Cache der Spieleliste), SQLite.
- **Oberfläche:** React 19 + Vite.
- **Werkzeuge:** 7-Zip (`7zz`), FFmpeg, Docker Engine.
- **Tests:** Node-Test-Runner (Unit) und Playwright + Headless Chromium (Spielkompatibilität).

## 🚀 Installation

Für **Docker Engine** unter Linux. Docker Desktop wird nicht empfohlen: über seine VM ist die Arbeit mit
großen Archiven langsam.

1. Repository klonen:
   ```bash
   git clone https://github.com/Raven632/rpg-library.git
   cd rpg-library
   ```

2. (Optional) Einstellungen anlegen — der Server startet auch ohne:
   ```bash
   cp .env.example .env
   ```
   Alle Einstellungen sind in der Datei beschrieben. Wichtig:
   - `SESSION_SECRET` — eigener Schlüssel: `openssl rand -hex 64`. Ohne ihn wird beim ersten Start einer
     erzeugt.
   - `SCRAPER_API_KEY` — ein kostenloser ScraperAPI-Schlüssel (1000 Credits im Monat): öffnet die Seiten
     von itch.io-Spielen; VNDB und Steam funktionieren auch ohne.
   - `HTTP_PORT` (80) — die Bibliothek, `GAME_PORT` (8081) — die Spiele. **Beide müssen** von deinen
     Geräten **erreichbar sein** (Heimnetz, Tailscale).
   - `TELEGRAM_BOT_TOKEN` — für Benachrichtigungen; dann in der Bibliothek „⋯ → Telegram → Verbinden“.

3. Starten:
   ```bash
   docker compose up -d --build
   ```

4. `http://<Server>` öffnen (Port `HTTP_PORT`) und das Konto anlegen.

### Update von 5.x

Spiele öffnen jetzt unter eigenem Port — `GAME_PORT` (Standard 8081): öffne ihn dort, wo `HTTP_PORT`
offen ist. Spielstände unter einem „korrigierten“ Ordnernamen ziehen beim ersten Start unter den echten
Namen des Spiels um. Laufen Spiele im Rahmen auf einem Gerät nicht, holt `GAME_ISOLATION=off` in `.env`
die alte Art zurück.

## 📂 Ordner

Der Ordner `./games` (`GAMES_HOST_DIR`) wird als `/games` in den Container eingebunden:

- `/games/<Spiel>` — die Spiele. In den Ordner eines Spiels schreibt der Server nie etwas.
- `/games/library.db` — die Datenbank.
- `/games/_saves` — Cloud-Spielstände; `_saves/.history` — frühere Versionen von Slots.
- `/games/_media` — Cover, Screenshots, Galerie-Verzeichnis und Vorschaubilder.
- `/games/_old` — frühere Versionen aktualisierter oder gepatchter Spiele.
- `/games/_tmp_uploads` — laufende Uploads.

## 📜 Änderungen

Was sich von Version zu Version geändert hat — in [CHANGELOG.md](CHANGELOG.md).

## 📝 Wenn die Suche danebenliegt

Spiel öffnen, „Bearbeiten“ drücken und einen Link einfügen — eine Seite auf itch.io, in Steam oder auf
VNDB. Die Daten werden sofort neu gesucht.

## 📄 Lizenz

Copyright © 2026 Raven. RPG Library ist freie Software unter der
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only): Du darfst sie nutzen, untersuchen,
ändern und weitergeben. Wer eine geänderte Version weitergibt oder sie für andere über ein Netzwerk
betreibt, muss ihren Quellcode unter derselben Lizenz veröffentlichen. Die Veröffentlichung 6.0 (Tag v6.0)
erschien für den eigenen Code unter MIT; das enthaltene fremde Cheat-Menü-Plugin war davon nie erfasst und
wurde entfernt. Übernommene Bestandteile und ihre Lizenzen — [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
