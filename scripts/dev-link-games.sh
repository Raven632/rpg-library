#!/usr/bin/env bash
# Подключает все игры прода в dev симлинками. Сами игры смонтированы в dev-контейнер
# только для чтения (docker-compose.dev.yml), поэтому dev не может их изменить или удалить.
# Можно запускать повторно: то, что уже есть, пропускается.
set -euo pipefail

PROD_GAMES=${PROD_GAMES_DIR:-/srv/rpg-library/games}
DEV_GAMES=$(cd "$(dirname "$0")/.." && pwd)/games

for game in "$PROD_GAMES"/*/; do
    name=$(basename "$game")
    case "$name" in _saves|_tmp_uploads|_media|_old) continue ;; esac   # служебные папки прода — не игры
    [ -e "$DEV_GAMES/$name" ] && continue                   # уже есть: ссылка или своя папка
    ln -s "$PROD_GAMES/$name" "$DEV_GAMES/$name"
    echo "+ $name"
done
