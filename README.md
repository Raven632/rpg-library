# 🎮 RPG Library v6.0

🇷🇺 [Русский](README.ru.md) | 🇩🇪 [Deutsch](README.de.md)

[![GitHub Release](https://img.shields.io/github/v/release/Raven632/rpg-library?style=for-the-badge&color=blue)](https://github.com/Raven632/rpg-library/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
![Tests: Passing](https://img.shields.io/badge/Tests-68_unit_%2B_game_compatibility-brightgreen?style=for-the-badge&logo=jest&logoColor=white)

![Node.js](https://img.shields.io/badge/Node.js-22.x-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)

A self-hosted web library for RPG Maker games (MV/MZ): keep them on your home server, play them in the
browser on a phone, tablet or PC, and let the server find everything about them.

![The library — a demo collection of fictional games](rest/img/library.png)

<p align="center">
  <img src="rest/img/game.png" alt="The game window" width="70%">
  <img src="rest/img/mobile.png" alt="On a phone" width="24%">
</p>

## ✨ Features

### Play

- **In any browser.** `rpg-fixes.js` stands in for NW.js, so the PC builds of RPG Maker games run on a
  phone too: sound on iPhone, videos, fonts, folders named in any letter case.
- **Cloud saves with history.** Saves go to the server — start on the PC, go on on the phone. Every
  overwritten slot is kept for a while, and "Save history" puts any version back; a save made offline
  never overwrites a newer one from another device.
- **Menu in the game:** turbo ×3, cheat menu, save anywhere on the map, on-screen gamepad and
  keyboard, a real gamepad, stretch and smoothing, frame counter.
- **Games run on their own address**, apart from the library: a game's code cannot reach the
  library's data or other sites.

### Library

- **Data found by itself** from itch.io, VNDB and Steam: cover, screenshots, description, tags,
  developer, release date. Every match is checked against all of the game's names.
- **A gallery from the game's own files** — CG, characters, backgrounds in albums, frames played as
  an animation, without playing the game.
- **Statuses set themselves** ("Playing", "Not started"), and **"What to play?"** picks a game among
  the ones not started, by genre.
- **New games** from the itch.io catalog — by tag, period, price and platform — with a
  "Want to play" list and a mark on the games you already have.
- **Stats and audit**: time played, gaps in the data, duplicates, heavy games, errors that games
  hit on your devices.

### Uploads

- **Any size, from a phone too.** A broken upload resumes where it stopped — after a reload or from
  another device. Archives with a password, a game packed inside another archive.
- **Update a game with its new version** — saves, time and data stay; **install a patch or a mod**
  (an English patch, a walkthrough mod) on top. The previous version is set aside and comes back with
  one button.

### Notifications and safety

- **Telegram** (optional, your own bot): finished uploads, a daily backup of the database and saves
  when something changed, problems. Silent except for problems, at most ten messages an hour.
- **Backup** of the database and saves from the menu; a nightly backup on the server.
- **Hardened:** login attempts are limited, the API answers only the library's own pages, a backup
  file carries no sign-in key, a deploy that does not come up is rolled back.
- **Interface** in English, Russian and German; hide covers with one button; live sync between
  devices.

## 🧩 Under the hood

- **Game isolation.** Games are served from a separate origin (`GAME_PORT`). A game gets its files and
  saves only by a key in its address — an HMAC of the session secret, the game and its folder — so
  signing out or replacing the game changes it. A Content-Security-Policy keeps the game's code from
  calling other sites, and the library's API checks Fetch Metadata (`Sec-Fetch-Site`), so a game
  cannot call it either. The library opens the game full-screen in a sandboxed frame and talks to it
  with `postMessage`.
- **NW.js in the browser.** `api/public/rpg-fixes.js` gives PC builds what they expect from NW.js:
  stand-ins for Node's `fs` and `path`, a per-game `localStorage` namespace, cloud saves with an offline
  queue and conflict detection, a touch gamepad, the iOS audio unlock, and error reports back to the
  server.
- **Resumable uploads.** Archives go up in pieces sized to the connection (16–256 MB) and resume by a
  file fingerprint — name, size and a hash of the first and last megabyte — after a reload or from
  another device. Unpacking runs in the background and is finished after a server restart. On iOS a
  large request's response never resolves, so the page confirms each piece through a short status
  request instead.
- **Saves.** Atomic writes (temporary file + rename), a thinned history per slot (the last five, then
  one per 10 minutes, at most 30) and a conflict check by the client's save time.
- **Updates and patches without copies.** A patch is laid over a hard-linked copy of the game
  (`cp -al`); changed files are unlinked before being replaced, so the previous version keeps its own.
  Where a patch's files go is found by matching them against the game's files, case-insensitively.
- **Gallery index.** Only the first 40 bytes of each picture are read: PNG `IHDR`, WebP `VP8`/`VP8L`/
  `VP8X` and RPG Maker's encrypted headers give the size; size and byte density sort pictures into CG,
  characters, backgrounds and layers; names group frames into albums. Thumbnails are WebP made once by
  FFmpeg.
- **Metadata lookup.** Each lookup tracks which sources did not answer (`AsyncLocalStorage`), so "not
  found" and "could not ask" are different results with their own retry schedule; titles are cleaned
  and compared by a Dice coefficient; ScraperAPI requests are capped by a daily credit budget.
- **Operations.** Docker Compose; a pull-based deploy that checks health and rolls back to the
  previous image; nightly backups; Telegram alerts; CI runs the tests and the build and then moves the
  `deploy` branch the server follows.
- **Tests.** Node's test runner, no network: sources are faked, uploads and the game server run on
  real HTTP servers on free ports. A Playwright check opens every game of a library in headless
  Chromium and reports the scene it reached.

## 🛠 Tech Stack

- **Backend:** Node.js 22, Express, Socket.io, Redis (games list cache), SQLite.
- **Frontend:** React 19 + Vite.
- **Tools:** 7-Zip (`7zz`), FFmpeg, Docker Engine.
- **Tests:** Node test runner (unit) and Playwright + headless Chromium (game compatibility).

## 🚀 Installation

Built for **native Docker Engine** (Linux). Docker Desktop is not recommended: file I/O through its VM
is slow with large archives.

1. Clone the repository:
   ```bash
   git clone https://github.com/Raven632/rpg-library.git
   cd rpg-library
   ```

2. (Optional) Create your settings — the server also starts without them:
   ```bash
   cp .env.example .env
   ```
   Every setting is described in the file. Worth a look:
   - `SESSION_SECRET` — your own key: `openssl rand -hex 64`. Without it one is made on first start.
   - `SCRAPER_API_KEY` — a free ScraperAPI key (1000 credits a month) opens itch.io game pages; VNDB
     and Steam work without it.
   - `HTTP_PORT` (80) — the library; `GAME_PORT` (8081) — the games. **Both must be reachable** from
     your devices (home network, Tailscale).
   - `TELEGRAM_BOT_TOKEN` — for notifications; then "⋯ → Telegram → Connect" in the library.

3. Start:
   ```bash
   docker compose up -d --build
   ```

4. Open `http://<server>` (port `HTTP_PORT`) and create the master account.

### Upgrading from 5.x

Games now open on their own port, `GAME_PORT` (8081 by default): open it where you opened `HTTP_PORT`.
Saves kept under a "corrected" folder name are moved to the game's own name on the first start. If
games in a frame do not run on some device, `GAME_ISOLATION=off` in `.env` brings back the old way.

## 📂 Directory Structure

The `./games` folder (`GAMES_HOST_DIR`) is mounted into the container as `/games`:

- `/games/<game>` — the games, unpacked. Nothing is ever written into a game's folder.
- `/games/library.db` — the database.
- `/games/_saves` — cloud saves; `_saves/.history` — previous versions of slots.
- `/games/_media` — covers, screenshots, gallery index and thumbnails.
- `/games/_old` — previous versions of updated or patched games.
- `/games/_tmp_uploads` — uploads in progress.

## 📜 Changelog

What changed in each version — in [CHANGELOG.md](CHANGELOG.md).

## 📝 When the lookup misses

Open the game, press "Edit" and paste a link — an itch.io page, a Steam store page or a VNDB entry.
The data is found again at once.

## 📄 License

[MIT](LICENSE)
