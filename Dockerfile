FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

---

FROM node:18-alpine AS runner

WORKDIR /app

COPY package*.json .npmrc ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

RUN mkdir -p public/uploads

ENV NODE_ENV=production
ENV ROOT_PATH=.
EXPOSE 3002

CMD ["node", "dist/main"]
