# ==========================================
# ЭТАП 1: Сборка фронтенда (React/Vite)
# ==========================================
# Используем ультра-легкий Alpine Linux (весит 5МБ) для быстрой сборки
FROM node:22-alpine AS builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
# npm ci собирает пакеты строго по lock-файлу, это быстрее и надежнее в Docker
RUN npm ci || npm install

COPY frontend/ ./
RUN npm run build
# На выходе получаем готовую папку /app/frontend/dist

# ==========================================
# ЭТАП 2: Сборка Бэкенда и финальный релиз
# ==========================================
# Используем slim-версию (весит ~200МБ вместо 1.1ГБ стандартного node:20)
FROM node:22-slim

WORKDIR /app/api

# Устанавливаем системные пакеты
# curl — для ручной проверки изнутри контейнера; 7-Zip — официальная сборка 7zz, а не старый p7zip из Debian
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    ffmpeg \
    python3 \
    build-essential \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && wget -q https://github.com/ip7z/7zip/releases/download/26.00/7z2600-linux-x64.tar.xz \
    && tar xf 7z2600-linux-x64.tar.xz 7zz \
    && mv 7zz /usr/local/bin/7zz \
    && rm -f 7z2600-linux-x64.tar.xz

# Копируем package.json бэкенда
COPY --chown=node:node api/package*.json ./

# Объединяем все установки NPM в один слой (RUN) для экономии места.
# nodemon оставляем глобально, чтобы работал твой docker-compose.dev.yml
RUN npm install --omit=dev && \
    npm install sqlite3 sqlite --build-from-source && \
    npm install -g nodemon

# Копируем исходники бэкенда
COPY --chown=node:node api/ ./

# МАГИЯ: Забираем собранный сайт из первого этапа
COPY --chown=node:node --from=builder /app/frontend/dist/ ./public/

# Точка входа: готовит смонтированную папку и сбрасывает права до пользователя node
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
# Запускаем сервер
CMD ["node", "server.js"]
