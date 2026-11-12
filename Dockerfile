# Container image for hosts that run a real process (Railway, Render, Fly.io).
# Puppeteer needs actual Chromium, which is why this is not a serverless deploy.
FROM node:24-slim AS base
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NEXT_TELEMETRY_DISABLED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-crosextra-carlito ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS run
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json ./
EXPOSE 3000
CMD ["npm", "start"]
