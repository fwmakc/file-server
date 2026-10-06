FROM node:24-alpine AS builder

WORKDIR /app

# Correct var name for puppeteer 21 (PUPPETEER_SKIP_CHROMIUM_DOWNLOAD is ignored) —
# chromium comes from apk in the runner stage
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY file-server/package*.json file-server/.npmrc ./
# Install against local stubs instead of the git-pinned toolkit and event
# contracts: npm "prepares" git deps by installing their whole devDependency
# tree from the registry just to run `prepare` — slow and network-flaky —
# and reifies stale git entries from the lockfile even after package.json
# changed. Both files are rewritten here; the real packages are copied into
# node_modules right after the install.
RUN mkdir -p toolkit-stub contracts-stub \
    && node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dependencies['api-server-toolkit']='file:./toolkit-stub';p.dependencies['event-server']='file:./contracts-stub';fs.writeFileSync('package.json',JSON.stringify(p,null,2));const l=JSON.parse(fs.readFileSync('package-lock.json','utf8'));delete l.packages['node_modules/api-server-toolkit'];delete l.packages['node_modules/event-server'];const fix=(d)=>{for(const n of ['api-server-toolkit','event-server']){if(d&&d[n])d[n]=n==='api-server-toolkit'?'file:./toolkit-stub':'file:./contracts-stub';}};fix(p.dependencies);if(l.packages&&l.packages['']){fix(l.packages[''].dependencies);}if(l.dependencies){fix(l.dependencies);}fs.writeFileSync('package-lock.json',JSON.stringify(l,null,2))" \
    && echo '{"name":"api-server-toolkit","version":"0.0.0-stub","dependencies":{"@supercharge/request-ip":"*","prom-client":"*"}}' > toolkit-stub/package.json \
    && echo '{"name":"event-server","version":"0.0.0-stub"}' > contracts-stub/package.json
RUN --mount=type=cache,target=/root/.npm npm install --legacy-peer-deps --install-links \
  --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 --fetch-timeout=600000

# Drop the installed stubs before the source COPY: a host context that
# carries node_modules (local builds) can hold phantom directories at these
# paths, and BuildKit refuses to copy a directory over the installed
# package. CI contexts are clean, so this is a no-op there.
RUN rm -rf node_modules/api-server-toolkit node_modules/event-server
COPY api-server-toolkit/package.json ./node_modules/api-server-toolkit/package.json
COPY api-server-toolkit/dist ./node_modules/api-server-toolkit/dist
COPY api-server-toolkit/src ./node_modules/api-server-toolkit/src
COPY event-server/dist/contracts ./node_modules/event-server/dist/contracts
COPY event-server/package.json ./node_modules/event-server/package.json

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
  CMD wget -qO- http://127.0.0.1:3002/health || exit 1

CMD ["node", "-r", "tsconfig-paths/register", "dist/main"]
