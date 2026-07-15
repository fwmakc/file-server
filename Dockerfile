FROM node:18-alpine AS builder

WORKDIR /app

COPY file-server/package*.json file-server/.npmrc ./
RUN npm ci

COPY file-server/ ./
RUN npm run build

# --- Runner ---

FROM node:18-alpine AS runner

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN mkdir -p public/uploads

ENV NODE_ENV=production
ENV ROOT_PATH=.
EXPOSE 3002

CMD ["node", "dist/main"]
