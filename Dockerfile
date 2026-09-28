FROM node:24-alpine AS builder

WORKDIR /app

# Correct var name for puppeteer 21 (PUPPETEER_SKIP_CHROMIUM_DOWNLOAD is ignored) —
# chromium comes from apk in the runner stage
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY file-server/package*.json file-server/.npmrc ./
RUN npm install --legacy-peer-deps

COPY api-server-toolkit/dist ./node_modules/api-server-toolkit/dist
COPY api-server-toolkit/src ./node_modules/api-server-toolkit/src

COPY file-server/ .
RUN npx tsc -p tsconfig.build.json

# --- Runner ---

FROM node:24-alpine AS runner

RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ttf-freefont

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN mkdir -p public/uploads public/generated && chown -R node:node public

ENV NODE_ENV=production
ENV ROOT_PATH=.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=3s --retries=5 --start-period=15s \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "-r", "tsconfig-paths/register", "dist/main"]
