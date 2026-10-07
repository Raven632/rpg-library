# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Changed

- **The server deploys a branch the CI moves.** When the tests and the build of a commit on `main`
  pass, the CI moves the `deploy` branch to it, and `deploy/pull-deploy.sh` deploys that branch over
  SSH. It no longer asks GitHub's API whether the CI is green — a private repository would not answer
  that without a token, and tokens expire.

### Fixed

- **An MV game no longer hangs when an image name contains "%".** RPG Maker MV 1.6 decodes an image
  path before loading it, so a sprite like `$Hero%(8).png` (the naming of the ExtraMovementFrames
  plugin) was requested with a bare "%", and the server answered 400 before any of its own code ran.
  Both the game server and the library now read a "%" not followed by two hex digits as a percent
  sign. Found and fixed by @tk344 (#1).

## [6.0] — 2026-09-29

**Upgrading from 5.x:** games now open on their own port, `GAME_PORT` (8081 by default) — open it
where `HTTP_PORT` is open (home network, Tailscale). Saves kept under a "corrected" folder name move to
the game's own name on the first start. If games in a frame do not run on some device,
`GAME_ISOLATION=off` in `.env` brings back the old way. Telegram is optional: `TELEGRAM_BOT_TOKEN`,
then "⋯ → Telegram" in the library.

### Added

- **A gallery from the game's own files.** "Gallery" in the game window opens every picture the
  game ships, decrypted on the fly (`.rpgmvp`, `.png_`), to look through without playing. Tabs:
  "CG", "Characters" (full-height portraits), "Backgrounds" (map and battle backdrops, pictures named
  like `Bg_…`, `Sky…`, `背景…`) and "All" (with the transparent layers the game builds its scenes
  from, and interface). An album is one scene with all its variants and frames — the name up to its
  first part with a number (`eva_c132_…` → CG 132, `CG_end_14` → `CG_end`): on a large game the
  album count went from 4,527 to 316. Its cover is its first real picture, not a transparent layer.
  Swipe or arrows flip through frames and on to the next album, "Play" runs the frames as an
  animation, the grid loads more as you scroll, and "Album 3 of 58 · frame 2 of 8" says where you
  are. The index is built once per game in the background — only the first 40 bytes of each picture
  are read, sizes are not encrypted — and opening the gallery prepares the covers of the first
  screens of every tab; thumbnails and the index live in `_media`, nothing is written into the game
  folder. An update, a patch or a restored version rebuilds it. "Hide covers" blurs the gallery too.
  Repacks that squeeze pictures into WebP but keep the `.png` name are read too, and a scene kept as
  a folder of numbered frames (`CG/Garden Walk/1.png`) is one album with the folder's name on it.
- **"What to play?"** in the menu: a random game among those you have not started or put in
  "Planned", narrowed by genre if you like; "Another one", "Play" and "Details" right there.
- **Errors in games from real devices.** A game that breaks — an error on the page, the engine's
  own error screen, a file that did not load — sends it to the server, and "Stats & audit" →
  "Audit" lists it under "Errors in games": which game, on which device (iPhone · Safari, web app,
  Windows · Chrome…), how many times, with the file, line, scene and stack a tap away. The same
  error is one line with a counter; the game server's key never gets into the log.
- **A deploy that does not come up is rolled back.** The deploy script keeps the running image as
  `:previous`; if the new version does not build or does not answer within two minutes (the library
  and the game server), it goes back to the previous code and image, sends a Telegram message and
  skips that commit until a new one arrives. The container reports its health to `docker ps`, and
  container logs are capped at 3 × 10 MB.
- **Save history.** When a game overwrites a slot, the previous save is kept on the server: the last
  five, older ones one per 10 minutes, up to 30 per slot. "Save history" in the game window's "⋯"
  lists each slot with its versions — date, level, gold, time played and map — and "Restore" puts
  any of them back; what was in the slot goes to the history too. A slot deleted in the game or
  replaced by an import goes there as well. A save written while a device was offline no longer
  overwrites a newer one from another device: the older one is kept in the history and the game
  says so. Saves are written to a temporary file first, so a cut-off write never leaves half a slot.
  The history stays on the server and is not part of the backups.
- **Games run on their own address**, apart from the library (port `GAME_PORT`, 8081). A game's code
  is third-party code; on the library's address it ran with your sign-in and could call the
  library's API — download the database or delete games. Now a game gets only its own files and
  saves, by a key in its address that signing out changes, and it cannot reach other sites
  (Content-Security-Policy; what gets blocked is logged). The library opens the game full-screen in
  a frame, so the iPhone web app stays itself; the browser's Back button and "Back to library" in the
  game close it after the saves are sent, and a reload during play opens the game again. The
  library's API answers only the library's own pages. `GAME_ISOLATION=off` brings back the old way,
  should games in a frame not run on some device.
- **Telegram.** Your own bot (from @BotFather, its token in `.env`) connects in the menu's
  "Telegram" window with one tap on a link. It sends uploads that finished while the page was closed,
  a backup of the database and saves once a day when something changed (a 7z with a password if
  `BACKUP_PASSWORD` is set), and problems: low disk space, a backup not sent, the nightly server
  backup or a deploy that failed. Everything but problems comes silently, the same problem at most
  once a day, at most ten messages an hour; each kind can be switched off.
- **Patches and mods.** "Install a patch or mod" in the game window's "⋯" takes an English patch,
  a fan translation, a walkthrough or cheat mod and lays it over the game: where its files go is
  found by the files it replaces, whatever the folder names and letter case. The game before the
  patch is set aside like a previous version, and "Remove the patch" brings it back. Unchanged files
  are shared between the two versions, so the copy takes almost no space. A Windows patcher program
  is refused with a plain explanation.
- **Download a backup** from the menu: a fresh zip of the database (games, found data, playtime,
  statuses, ratings) and the saves, with the list of games and how to restore. The nightly
  backup stays on the library's own disk; this one goes to your computer or phone. Server
  settings with keys are not included, and neither is the sign-in: the key that the login cookie
  carries and the password stay on the server — with the key from the file anyone could open the
  library without a password. A restored library asks to create the account again.
- **Update a game with its new version.** "Update the game" in the game window's "⋯" menu takes
  the new version's archive and puts it in place of the old one under the same game: saves,
  playtime, status and found data stay with it, instead of a second copy of the game. The title
  follows the new version's own title unless you set it by hand, and the version comes from the
  archive's name (or that title). The old version is not deleted but set aside in `_old`; the menu
  offers to bring it back — for a wrong archive or a version that does not run — or to delete it,
  with its size. A game that cannot be updated here (a read-only folder) is refused before anything
  is uploaded. The library sync no longer drops a game whose folder was missing only for a moment,
  and the audit lists previous versions of deleted games.
- **Archives with a password.** When an uploaded archive is locked — its files, or even the list
  of them — the upload card asks for the password and the server unpacks the archive with it;
  a wrong one asks again. The archive waits on the server for a day, so after a reload the
  password field is in the "Unfinished" card. The password lives only in the server's memory
  while unpacking: it is never written to disk or to the log.
- **A game packed inside another archive.** When an unpacked upload has no game in it, the
  server looks for archives inside — a zip in a rar, a multi-part archive packed once more —
  and unpacks them too: the largest first, a multi-part one from its first part, up to three
  levels deep. The upload's password is tried on them as well, and each inner archive is
  deleted as soon as it is unpacked, to keep the disk free.
- **Uploads resume where they stopped.** A game archive goes to the server in pieces sized to
  the connection — 16 MB at first, up to 256 MB on a fast one — straight from the file, and the
  server keeps what it has got. A dropped connection, a phone that fell asleep, a server
  restart on deploy — the page waits and carries on from the byte the server stopped at,
  however many times it takes; a piece that sends nothing for 20 seconds is cut off and
  retried. "×" on the upload card cancels.
  When a piece hangs, is retried or the upload ends, the page sends its own step-by-step log
  to the server log, so it shows where a device got stuck. Picking the same file again
  continues it too, after a reload or from another device: the server knows the file by its
  name, size and a hash of its first and last megabyte, and keeps an unfinished upload for a
  day. After a reload the page shows what is left ("Unfinished: 450 MB of 1.1 GB") with
  Continue and delete buttons; an upload running on another device is shown without them.
  Unpacking runs in the background: the last piece is answered at once and the page asks how
  it goes, so a phone asleep through it still gets the result, and a server restart in the
  middle finishes it on start. Before unpacking, the server checks there is room for the
  unpacked game, and says in plain words when an archive is damaged, points outside the game
  or comes in parts. Where the browser allows it (HTTPS), the screen stays on while uploading.
- **New games** window: RPG Maker games from the itch.io catalog feeds — popular, new, top rated,
  top sellers or featured, for the last week or month, free or on sale, playable in the browser,
  by tag — with a mark on the ones already in the library. Opening a game reads its page through
  ScraperAPI for screenshots, tags, rating and description — ten credits a page, so a page is kept
  for a week, and once the day's allowance is spent the window says the page comes tomorrow. Feeds
  are free and cached for half an hour, because itch.io refuses after a few quick requests.
- **Want to play list.** A star on any card in New games saves the game with everything the window
  showed about it; the list is the window's second tab, and games already downloaded are marked.
- **Library audit: "Can be filled in", duplicates by store page, coverage.** A new section lists
  games whose data was found before the lookup got smarter and still has gaps — no store page,
  description, developer or date, screenshots — with the gaps named and "Search again" for all of
  them; a searched game leaves the list whether or not something was found, so the button never
  loops. Duplicates are also found by store page — an English and a Japanese folder of one game —
  and Japanese titles are finally compared too (the old key kept only Latin and Cyrillic letters).
  A line on top shows how many games have an itch.io, Steam and VNDB page.
- **Daily ScraperAPI ceiling**: at most 30 credits a day (`SCRAPER_DAILY_LIMIT`), so one
  heavy day — a metadata sweep, browsing itch.io — cannot eat the 1000 monthly credits.
  Credits are counted at the price ScraperAPI reports for each request: an itch.io page costs ten.
  A request that costs more than what is left for the day is refused by ScraperAPI itself
  (`max_cost`) and costs nothing; the lookup then reports "ScraperAPI (limit)" among the sources
  that did not answer. Every request is given 75 seconds: ScraperAPI charges for a request
  cancelled before 70, and one that gave up after 15 seconds paid ten credits for nothing.
- **itch.io links in the game window.** A game's itch.io page pasted into "Edit" is read
  through ScraperAPI and cached for a week. Its tags, description, developer, release date,
  cover and screenshots fill the card, and the link gets its own icon. There is no lookup by
  title: itch.io has no search the server can use, and a title alone easily matches someone
  else's game.
- **Metadata lookup.** A game is matched through itch.io (a pasted link), VNDB and Steam (a link,
  or a search by title with every match checked against the game's names).
- **Game images** — a cover and up to six in-game screenshots from the game's store page.
  Everything is stored in `_media`, never inside a game folder.
- **Sign-out button**, which until now had a route but no way to reach it.

### Changed

- **Faster.** A game launched again loads from the browser's cache: its files are cached for a year,
  and their address changes with the game folder, so an update, a patch or a restored version is
  never mixed with the old files (a second launch of a mid-size game went from 4.1 MB and 194 checks
  to 2 KB, 3.8 s to 1.3 s). `rpg-fixes.js` is cached until it changes instead of being loaded anew
  every time, and so are the library's own build files. Cards and the "Continue" strip get covers
  resized to 360 px (720 in the game window, screenshots 360) as WebP made once and kept in
  `_media/.thumbs`: the first screen on a phone went from about 2 MB of covers to 0.5 MB. Rare
  windows — New games, Stats & audit, Telegram, "What to play?", sign-in, save history, the
  gallery — load when first opened: the page itself is lighter. The disk space line answers at
  once; the full count runs in the background.
- The game window no longer shows "Language: —" when the language is unknown, and "Arrived" is now
  "Added".
- **Statuses set themselves.** "Playing" — a game played for at least ten minutes in the last two
  weeks; "Not started" — one never launched. Both work in the filters and the stats. A status
  picked by hand still wins; an automatic one is shown dashed in the game window, and a click
  keeps it. Favorites are gone: nobody used them.
- **Less on screen.** On a phone the toolbar is one row — search and "Filters", which unfolds
  genre, language, sorting and the covers switch, with the number of active filters on the button;
  the first game moved up by about 140px. The wide screen keeps everything in one row as before.
  A card names its language only when it is not the library's usual one, and shortly: "JP",
  "CN" — "ENGLISH" on every card was noise. The "⋯" menu is shorter: "New games", "Stats & audit"
  — one window with two tabs — and "Add game" on a phone; the language, disk space and "Sign out"
  are a small line at the bottom. In the game window "Backup", "Import" and "Delete" moved into
  "⋯" next to "Edit": delete no longer sits by a button pressed every day. The game status "Want to
  play" is now "Planned": it read exactly like the "Want to play" list of New games, which is a
  different thing.
- **"Fetch missing metadata"** also queues games that have no images, and no longer skips
  games that a previous sweep remembered as a miss: the button is pressed by hand, usually
  right after the parser was improved.
- **Titles are cleaned before searching** — version tails such as `v1.2`, `-final` or
  `Steam` are stripped, which is what makes matching by name work at all.
- **Nothing is written inside game folders any more.** Scraped covers used to land next to
  the game's own files; they now go to `_media` like the rest of the media.
- **Line endings are LF everywhere**, enforced by `.gitattributes`. Mixed CRLF and LF made
  a one-line edit show up as a rewritten file.
- **Icons** are real 32 / 180 / 192 / 512 px files instead of one 623 KB image served for
  every size; 1.8 MB of unreferenced duplicates removed.

### Fixed

- **A game stopped after choosing the language.** Three things in a row: its localization plugin
  calls `path.parse`, which the browser stand-in for Node's `path` did not have ("this.path.parse
  is not a function"); its folders are `Audio`, `Fonts`, `Movies`, while the engine asks for
  `audio/…` and `fonts/…` — Windows does not care, the server matched the letter case of the file
  name only, so the font never loaded and the game waited for it forever; and it checks the saved
  language with `localStorage.hasOwnProperty`, which the per-game storage always answered "no", so
  the language choice came back in a loop. The stand-in is now a full `path`, the letter case is
  matched in every folder of the path, and `hasOwnProperty` answers from the game's storage.
- **Saves of 14 games were kept under a "corrected" folder name** — spaces and every letter but
  Latin and Cyrillic became "_", so export and progress did not find them, and two Japanese titles
  of the same length would have shared one set of saves. Saves now go under the game's own folder
  name; the old folders are moved on start, and a save queued on a device under the old name is
  sent under the new one.
- **An archive with a Japanese name became a folder of underscores** — "スターフォールの宿.zip"
  was added as `_________`: only Latin and Cyrillic letters were kept. Letters of any script
  stay now, and a long name is cut by bytes, as Linux counts them, not by characters.
- **Uploading a game from an iPhone got stuck after the first piece.** The page's own log
  showed where: the iPhone (iOS 27, Safari and Chrome alike) sends the whole piece and gets the
  server's whole answer — 40 bytes, and its network stack acknowledges them — yet the request
  never finishes, through XMLHttpRequest or fetch. Short requests work. So once a piece is sent,
  the page now asks the server how much it has, and when the server confirms the piece, the
  upload goes on without the stuck answer. Other devices get their answer before the first
  question and ask nothing. The server logs every piece that arrives or breaks off, and closes
  the file of a broken one — it used to stay open.
- **The upload card showed the previous upload's last message** — an error from the last try
  stayed on top of the new progress. The card now shows only its own upload.
- **On iPhone as a web app the header hid under the status bar**, and with it the "⋯" menu, which
  could not be opened at all. The page now keeps clear of the status bar and the home indicator:
  the header, windows, toasts and the image viewer. On phones the header also stays on top while
  scrolling — it used to scroll away, because `overflow-x: hidden` on both `html` and `body` made
  the body a scroll container of its own; `clip` trims the width the same way without that.
- **A game that names itself in short got someone else's data.** Its own short title matched
  another game on Steam, while the archive's name had the whole title. The lookup now uses every
  name — the game's, the archive's and the readme's (『…』, UTF-8 or Shift_JIS) — searches the
  fullest first and checks each match against it. Joined words are split for the search, release
  tails ("English Release by …") are dropped, and the library card shows the full name.
- **A wrong Steam or VNDB link stuck for good.** Found by title, it was fed into the next search
  as an exact one. It is now checked again each time and leaves the card once the store answers.
- **Pictures did not refresh after a new search.** The cover and screenshots were saved under
  the same names, so the browser kept showing the old ones until the page was reloaded — and the
  cover even flipped back a second after saving. Files are now named by their content; the old
  ones are removed a minute later.
- **A custom cover was written into the game folder.** It goes to `_media` now, and resetting it
  brings back the found cover instead of leaving the game without one.
- **Steam returned nothing for some games** — the store answers `success: false` for age-gated
  titles without age-check cookies, so those games were silently skipped.
- **Images saved as `.jpg` were not JPEG.** Sources serve AVIF or WebP over a `.jpg` address, and a
  cover can be a 1.6 MB animation; every image is now re-encoded through ffmpeg.
- **Small previews (400×250) were saved as screenshots** instead of the full-size originals.
- **Repeating images** in a gallery — near-identical pictures are dropped by a perceptual
  hash, not only by an exact byte match.
- **Imported desktop saves never appeared in the game**, and MZ saves (`.rmmzsave`) were
  deleted as foreign files; both formats are renamed to the keys the engine asks for.
- **One oddly named save file emptied the whole save list** for that game.
- **A partial `/edit` request wiped the title** and other fields it did not carry.
- **The background scrape queue** resumes after a restart instead of waiting for a new task.

### Security

- **Signing out rotates the server session key**, so the cookie stops working everywhere at
  once and open sockets are dropped. Before, logout only cleared the cookie in that one
  browser.

## [5.0] — 2026-09-20

### Security

- **Auth bypass removed.** The hardcoded fallback session token is gone; the token is
  either taken from `SESSION_SECRET` or generated once and stored in the database.
- **Path traversal blocked.** Game ids containing `.`, `..` or slashes are rejected by a
  shared `router.param` validator, so a crafted `DELETE /api/games/..` can no longer
  reach the library root.
- **Redis is no longer published.** The cache is reachable only over the internal Docker
  network.
- **Login brute force.** `/api/login` and `/api/setup/init` allow 10 failed attempts per
  15 minutes per address; successful logins do not consume the budget.
- **Request body limit** lowered from 50 MB to 1 MB — bodies are parsed before
  authentication, so any unauthenticated client could tie up server memory.
- **Socket.io requires the session cookie.** Browsers do not apply CORS to WebSockets, so
  `cors: { origin: '*' }` left the event bus open to any page; connections are now checked
  in `allowRequest`.
- **Node 20 → Node 22 LTS** (Node 20 left support in April 2026).

### Added

- **Game status** — playing / finished / dropped / want to play — with a badge on the card
  and a filter row in the toolbar.
- **Favorites** with a star on the card and its own filter.
- **Live sync across devices.** Any change to the library is broadcast over Socket.io, so a
  status set on the phone appears on the desktop without a reload.
- **Hide covers** toggle that blurs every cover on the page; the choice is remembered.
- **Sorting** by oldest first and by size, with a stable order for equal values.
- **Last played** is now recorded when a game is launched, which makes "recently played"
  work.
- **Disk usage widget** in the header.
- **Automated compatibility check** (Playwright + headless Chromium) that opens every game
  and reports the scene it reached.
- **Pull-based deployment and backups** as systemd timers.

### Changed

- **Games list is cached in Redis** and invalidated on every change to the library.
- **Uploads stream to disk** instead of being buffered and re-written, which removes the
  I/O amplification on multi-gigabyte archives.
- **Covers get a cache-busting URL**, so a replaced cover updates on the main page too.
- **Background refresh is debounced** and silent, so a burst of server events causes a
  single request.
- Design pass: loading skeletons, keyboard focus styles, larger touch targets, mobile
  layout fixes, and no sticky `:hover` on touch devices.

### Fixed

- Games that hung on launch because of a `JSON.parse` patch in `rpg-fixes.js`.
- Missing languages in games that read files through `fs`.
- Audio that stopped after the phone screen was locked.
- Video playback on iOS, the on-screen D-Pad, and Steam/Greenworks stubs.
- Unit tests no longer depend on the environment's cookie name, and the dev container
  runs the current test file instead of the copy baked into the image.
