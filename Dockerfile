# Один процесс отдаёт и сайт, и API: так всё живёт на одном домене, без CORS и без чужого CDN.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Зависимости ставим отдельным слоем, чтобы пересборка была быстрой
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src
COPY scenarios ./scenarios
COPY docs ./docs

# База лежит на постоянном диске Amvera, иначе прогресс пропадёт при перезапуске
ENV DB_PATH=/data/bot.db
ENV SERVE_STATIC=1
ENV PORT=80
EXPOSE 80

CMD ["node", "src/index.js"]
