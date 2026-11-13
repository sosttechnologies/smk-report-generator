# Container image for hosts that run a real process (Fly.io, Railway, Render).
# Puppeteer needs actual Chromium, which is why this is not a serverless deploy.
FROM node:24-slim AS base
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NEXT_TELEMETRY_DISABLED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-crosextra-carlito ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The Prisma client is generated code, so it must exist before the Next build type-checks
# anything that imports it. It needs no database — only the schema.
RUN npx prisma generate
RUN npm run build

FROM base AS run
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
# Generated Prisma client from the build stage, not the bare one from deps.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# Needed at boot to apply migrations.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY package.json ./
EXPOSE 3000
# Migrations run on every boot: the schema a release expects is part of the release.
# If they fail the container exits rather than serving against a mismatched database.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
