FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

CMD ["node", "bot.js"]