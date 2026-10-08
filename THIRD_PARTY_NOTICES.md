# Third-party software and assets

RPG Library's own code is licensed under the GNU AGPL-3.0 (see [LICENSE](LICENSE)). This file lists what
it uses from other people, under which license, and where it comes from. None of these components were
changed.

## In this repository

| What | Where | License |
|---|---|---|
| Logos of Steam, VNDB and itch.io | `frontend/public/*-logo.*` | Trademarks of their owners, **not** covered by this project's license; used only to mark links to those sites |

The cheat menu (`api/public/cheats.js`) is this project's own code. Version 6.0 shipped a third-party
cheat menu plugin instead; it was removed.

## Installed when the server and the interface are built (npm)

Server (`api/package.json`):

| Package | License |
|---|---|
| express, compression, cookie-parser, multer, express-rate-limit, helmet | MIT |
| socket.io, redis (node-redis), sqlite, lz-string, bcrypt | MIT |
| sqlite3 | BSD-3-Clause |
| dotenv | BSD-2-Clause |

Interface (`frontend/package.json`): react, react-dom, socket.io-client — MIT. Build and check tools
(not shipped to users): vite, @vitejs/plugin-react, eslint and its plugins, globals, @types/* — MIT.

Each package brings its own dependencies; their licenses are in `node_modules/<package>/` after
`npm ci`. Almost all are permissive (MIT, ISC, BSD, Apache-2.0 and similar); the build tools also pull in
MPL-2.0 packages (lightningcss) and CC-BY-4.0 data (caniuse-lite), which are used only while building and
are not shipped. SQLite itself, built into sqlite3, is in the public domain.

## In the Docker image

| What | License | Source |
|---|---|---|
| Node.js 22 (`node:22-slim`, Debian) | MIT; Debian packages — their own licenses | [nodejs.org](https://nodejs.org/), [debian.org](https://www.debian.org/) |
| FFmpeg (Debian package `ffmpeg`), run as a separate program | LGPL-2.1+ / GPL-2.0+ | [ffmpeg.org](https://ffmpeg.org/), sources in Debian |
| 7-Zip `7zz` 26.00, run as a separate program | GNU LGPL-2.1+ with the unRAR license restriction; some parts BSD-3-Clause | [7-zip.org](https://www.7-zip.org/), [github.com/ip7z/7zip](https://github.com/ip7z/7zip) |

## Services in `docker-compose.yml`

| What | License | Note |
|---|---|---|
| Redis 7 (`redis:7-alpine`) | 7.4 and later: RSALv2 / SSPLv1 (source-available); earlier 7.x: BSD-3-Clause | Used unchanged, as its own container |

## Games

Games are not part of this project: each one belongs to its authors and is kept, unchanged, in your own
library folder.
