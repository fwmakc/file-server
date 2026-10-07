# File Server

[![Tests](https://github.com/fwmakc/file-server/actions/workflows/test.yml/badge.svg)](https://github.com/fwmakc/file-server/actions/workflows/test.yml)
[![Version](https://img.shields.io/badge/version-v0.8.3-blue)](https://github.com/fwmakc/file-server/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](https://github.com/fwmakc/file-server/blob/master/LICENSE)

> Reference implementation: file service with built-in authorization — uploads, ACL sharing, image processing, PDF generation.

## What This Is

A working file service — upload, validation, image resize/convert, PDF
generation from EJS templates, and **first-class access control**: every
object lives under its owner's namespace, sharing is explicit (per file or
folder prefix), public assets are served anonymously and cacheable. Part of
a [microservices stack](https://github.com/fwmakc/gateway-server).

## Role in the stack

```
client → nginx → file-server (upload, download, ACL)
file-server → auth-server (JWT via JWKS, roles via internal API)
file-server → Postgres (ACL rules, grants, webhook ledger)
file-server → local filesystem or S3 (object bytes)
file-server ← event-server (user.deleted → grant cleanup)
```

**Dependencies:** auth-server (JWT + roles + account existence), Postgres, event-server (optional, `EVENT_SERVER_URL`)
**Dependents:** nginx (routes `/files`, `/uploads`), api-server (proxying)

## Pattern

This service demonstrates the **file-service pattern** in the toolkit stack:

- **Owned authorization** — file-server resolves every read/write against
  its own ACL tables at the same edge that serves the bytes; no other
  service decides who may touch a file
- **Storage abstraction** — `IFileStorage` with local and S3 backends
- **Stream processing** — multipart upload, image resize via sharp
- **Template rendering** — PDF generation from EJS templates
- **Event-driven cleanup** — deleted accounts lose their grants via the
  event bus (idempotent webhook ledger)

Clone this when you need: file handling, media processing, document generation, any stateless workload.

## Quick start

```bash
cp .env.example .env
npm install --legacy-peer-deps
npm run dev
```

Postgres is required (`DB_*` in `.env`) — pending migrations apply on boot
under an advisory lock.

## API reference

All routes require a JWT unless stated otherwise. Write targets outside the
account namespace need a write grant (or staff role) — see
[Access control](#access-control-acl).

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/files/upload` | JWT | Upload files (multipart/form-data); lands in `<accountId>/` or the granted folder |
| DELETE | `/files/*` | JWT | Delete an object (and its rules); needs write access, strangers get 404 |
| POST | `/files/presign/upload` | JWT | Presigned PUT key (S3 mode); folder resolved against ACL |
| POST | `/files/presign/download` | JWT | Presigned GET URL (S3 mode); needs read access |
| GET | `/uploads/*` | public* | Download: public prefixes anonymous + cacheable; private — owner/grants/staff, strangers get 404 |
| POST | `/files/acl` | JWT | Create/update a rule (owner of the namespace or staff) |
| GET | `/files/acl/*` | JWT | Inspect the rule in force at the path (needs read access) |
| GET | `/health`, `/health/storage` | public | Liveness / storage ping |

### Upload example

```bash
curl -X POST http://localhost:3002/files/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@photo.jpg" \
  -F 'options={"resize":{"width":800}};type=application/json'
# → [{ "url": "/uploads/42/photo.jpg", ... }]   (42 = account id from the token)
```

### Upload options

Options are passed as JSON in the `options` form field:

| Option | Type | Description |
|--------|------|-------------|
| `folder` | string | Target folder; own namespace by default, shared prefix with a write grant |
| `replace` | boolean | Overwrite an existing object (still needs write access) |
| `resize` | `{width?, height?}` | Resize image (preserves aspect ratio) |
| `convertToWebp` | boolean | Convert image to WebP format |
| `maxSize` | number | Max file size in bytes |
| `allowTypes` | string[] | Allowed MIME types (exact tokens) |

## Access control (ACL)

file-server owns file authorization end-to-end. The model:

- **Namespace**: every key lives under `<accountId>/…`. An empty `folder`
  lands in the account root; the client never picks the root.
- **Private by default**: an object with no rule is readable/writable only
  by its owner and staff. Everyone else — including anonymous — gets 404
  (existence is never revealed).
- **Rules** (`file_acl`): a path is either an exact file key or a folder
  prefix (trailing slash). A rule carries `visibility`
  (`private` | `public`) and **grants** — `u:<accountId>` or `r:<role>`
  with mode `read` or `write` (write implies read).
- **Longest prefix wins**: the most specific rule in force decides. A
  private override deep inside a public tree works as expected.
- **Staff** (`isSuperuser`, `admin`, `editor`): global bypass. Keys from
  before the ACL era (outside any namespace) are staff-only by construction.
- **Public visibility**: anonymous GETs are served with
  `Cache-Control: public, max-age=PUBLIC_CACHE_TTL` (default 300 s) so
  nginx/CDN absorb the hot path; safe raster images, fonts and css render
  inline (SVG deliberately stays attachment — XSS). Private bytes are
  always `attachment` + `private, no-store`.
- **Grant validation**: `accountId` grants are checked against
  auth-server internal info — unknown accounts are rejected with 400.
- **Account deletion**: `user.deleted` events from the bus revoke all
  grants of the deleted account (idempotent via a webhook ledger table).
- **Auth-cache invalidation**: every delivery of `user.deleted`,
  `user.deactivated` or `user.roles_changed` also drops the auth-client
  cache entry for that user — **on every delivery, outside the ledger**.
  The ledger dedupes ACL writes (they must apply once), but each replica
  owns its own auth cache, so invalidation must run per replica: role
  revocations and deactivations take effect on all replicas immediately
  instead of aging out over the cache TTL (30 s).

### Event subscription

On boot the service registers with event-server (`service: file-server`,
patterns `user.deleted` / `user.deactivated` / `user.roles_changed`). The
default webhook url is `http://<container-hostname>:3002[/PREFIX]/webhooks/events`
— subscriptions key on `(service, url)`, so each `--scale` replica
registers as its own subscriber and every one receives the delivery
(per-replica fan-out; a dead replica is dropped by event-server's circuit
breaker — `subscriber.deactivated` noise is expected). Set `WEBHOOK_URL`
to override for single-instance mode. Env: `EVENT_SERVER_URL`
(`disabled` turns the subscription off), `WEBHOOK_SECRET` (same value as
event-server's to enable signed delivery).

### Sharing examples

```bash
# Make a folder readable by the world, writable by authors (case 1: site assets)
curl -X POST http://localhost:3002/files/acl -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"path":"site-assets","pathType":"folder","visibility":"public","grants":[{"role":"author","mode":"write"}]}'

# Share a personal document with one account — read-only (case 2)
curl -X POST http://localhost:3002/files/acl -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"path":"42/scan.pdf","pathType":"file","grants":[{"accountId":43,"mode":"read"}]}'

# Give an account full control over a folder (read + replace + delete)
curl -X POST http://localhost:3002/files/acl -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"path":"42/docs","pathType":"folder","grants":[{"accountId":43,"mode":"write"}]}'

# Inspect the rule in force at a path
curl http://localhost:3002/files/acl/42/docs -H "Authorization: Bearer $TOKEN"
```

## Configuration (.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3002 | HTTP port |
| `DB_TYPE` | postgres | Database driver (Postgres) |
| `DB_HOST` / `DB_PORT` | localhost / 5432 | Postgres connection |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | — | Database credentials (required; migrations apply on boot) |
| `FILE_STORAGE` | local | Storage backend: `local` or `s3` |
| `UPLOADS_PATH` | ./public/uploads | Storage directory (local backend) |
| `UPLOADS_URL` | /uploads | Public URL prefix (download route in both modes) |
| `PUBLIC_CACHE_TTL` | 300 | Cache-Control max-age for public prefixes (seconds) |
| `MAX_UPLOAD_SIZE` | 50 | Hard multer ceiling for direct upload (MB) |
| `UPLOADS_MAX_SIZE` | 1048576 | Max file size after per-file filters (bytes) |
| `UPLOADS_ALLOW_TYPES` | — | Comma-separated MIME types (exact tokens) |
| `UPLOADS_IMAGE_MAX_WIDTH` | 3840 | Max image width before resize |
| `UPLOADS_IMAGE_MAX_HEIGHT` | 2160 | Max image height |
| `AUTH_SERVER_URL` | http://localhost:3001 | Auth server: JWKS + roles via internal API |
| `INTERNAL_API_KEY` | — | Service-to-service key (required in the stack) |
| `EVENT_SERVER_URL` | — | Event bus base URL; `disabled` turns the subscription off |
| `WEBHOOK_URL` | — | Overrides the per-replica default webhook url (own container hostname) — use for single-instance mode |
| `WEBHOOK_SECRET` | — | HMAC secret for event deliveries (set on both services) |
| `S3_BUCKET` | — | Bucket name (required in s3 mode) |
| `S3_REGION` | us-east-1 | S3 region |
| `S3_ENDPOINT` | — | Custom endpoint (MinIO, Yandex Object Storage, …) |
| `S3_ACCESS_KEY_ID` | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | — | S3 secret key |
| `S3_FORCE_PATH_STYLE` | false | `true` for MinIO-style path addressing (`endpoint/bucket/key`) |
| `S3_PUBLIC_URL` | — | Absolute base returned in upload URLs (CDN / public bucket) **for keys under a public rule**; private keys always get the ACL-proxied `UPLOADS_URL` link. Note: the bucket itself stays publicly readable in this mode — treat object keys as capability URLs |
| `S3_PRESIGN_ENDPOINT` | — | External endpoint the client uses for presigned URLs |
| `S3_PRESIGN_EXPIRES_SEC` | 900 | Presigned URL lifetime |

## PDF generation

PDF generation uses Puppeteer (Chromium) with EJS templates:

1. Place EJS templates in `views/pdf/<template>.ejs`
2. Call the `PdfGenerateHandler` with template name and data
3. Puppeteer renders HTML → PDF

In Docker, system Chromium is used (`/usr/bin/chromium-browser`) via `PUPPETEER_EXECUTABLE_PATH`.

## Docker

The Dockerfile installs system Chromium and dependencies for Puppeteer.
Uploads are stored in a Docker volume (`uploads_data`).

## Storage backends

Uploads go through the `IFileStorage` abstraction (`src/files/storage/`);
the backend is selected by `FILE_STORAGE`:

- **`local`** (default) — files under `UPLOADS_PATH`. Single-instance
  only: the disk is ephemeral per container unless you mount a shared
  volume.
- **`s3`** — files stored in any S3-compatible API (AWS S3, MinIO,
  Yandex Object Storage). Required for horizontal scaling: all instances
  see the same data and containers stay stateless. Verified live with
  `--scale file-server=2` (SeaweedFS): an upload landing on one replica is
  served by both — the shared bucket removes the local mode's
  single-instance limit.

Reachability: `GET /health/storage` probes the bucket **from this process**
(`S3_ENDPOINT`). The client-facing `S3_PRESIGN_ENDPOINT` is probed too, but a
failure there only logs a WARNING — segmented networks routinely keep the
client endpoint unreachable from the server container (dev published port,
edge subdomain behind a CDN), and it serves browsers, not this process, so it
must not flip readiness.

In both modes bytes are served by the same ACL-guarded download route at
`UPLOADS_URL` (`/uploads/<key>`), so object URLs are identical — public
prefixes anonymously and cacheable, private ones only to owner/grants/staff.
Set `S3_PUBLIC_URL` (CDN or a public bucket base) to return direct CDN URLs
in upload responses — but only for keys a rule already makes public; private
uploads always get the ACL-proxied `UPLOADS_URL` link, so a CDN can never
bypass the authorization edge for them.

MinIO example:

```env
FILE_STORAGE=s3
S3_BUCKET=uploads
S3_ENDPOINT=http://minio:9000
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
```

## AI-Friendly Documentation

This service is designed for AI-assisted development. You can feed context
to any LLM (ChatGPT, Claude, Cursor, Copilot) and get code that follows
all conventions — without reading the entire codebase.

### ai-context.md
Auto-generated structured reference: every controller, route, service,
entity, and DTO. Run `npm run ai-context` to regenerate.

### Swagger UI
Interactive API exploration at `/swagger` — test the upload endpoint live,
see request schemas, copy curl commands.

### ReDoc
Clean, readable documentation at `/redoc` — share with your team.

### Why this matters
An LLM with `ai-context.md` can generate new file handlers, validators,
and EJS templates that match your existing patterns — on the first try,
without trial and error.

## Backend-Only — Bring Your Own Frontend

This service handles file storage and processing. No frontend included.

The upload endpoint accepts standard `multipart/form-data` — works with
any frontend: React dropzone, Vue upload component, mobile camera capture,
or plain `<input type="file">`.

## Integrating into existing infrastructure

Already have a file storage solution? You can adopt file-server selectively:

- **Need image processing?** Run file-server alongside your existing API.
  Your frontend uploads to file-server, gets back a URL — no changes to
  your main API.
- **Already have S3/MinIO?** Replace `SaveHandler` with S3 upload logic.
  The upload validation pipeline (type checking, size limits, resize)
  stays the same.
- **Need PDF generation?** File-server includes Puppeteer + EJS templates.
  POST your data, get a PDF back — no need to set up a separate rendering
  service.

## Related services

- [auth-server](https://github.com/fwmakc/auth-server) — JWT verification
- [gateway-server](https://github.com/fwmakc/gateway-server) — Docker Compose, Nginx

---

## Versioning

Each service versions **independently** (semver): a `vX.Y.Z` git tag marks the released state of each repo. There is no stack-wide shared major — compatibility is guaranteed by **exact dependency pins**, not by version numbers.

- Repos on `0.x` (toolkit, api/auth/file/message-server, gateway): the minor carries breaking changes while the stack is in development; patch = fixes.
- `event-server` follows a `1.x` line (stable event-contract surface).
- Consumers pin sources by tag: `"api-server-toolkit": "github:fwmakc/api-server-toolkit#v0.32.0"`, `"event-server": "github:fwmakc/event-server#v1.6.0"`.

### Breaking-change procedure

1. Bump the source repo (toolkit or event-server), tag the release, push.
2. In each consumer: bump the pin in `package.json` (a dedicated `build: pin …` commit), run the tests, push.
3. Update the `Current versions` table below in every repo so it keeps reflecting the actual tags.

### Current versions

> Synced across all repos on 2026-10-07 (wave 13). Source of truth: the `v*` git tags at each repo HEAD.

| Service | Version |
|---------|---------|
| [api-server-toolkit](https://github.com/fwmakc/api-server-toolkit) | v0.32.0 |
| [event-server](https://github.com/fwmakc/event-server) | v1.6.0 |
| [auth-server](https://github.com/fwmakc/auth-server) | v0.14.0 |
| [message-server](https://github.com/fwmakc/message-server) | v0.7.0 |
| [file-server](https://github.com/fwmakc/file-server) | v0.8.3 |
| [chat-server](https://github.com/fwmakc/chat-server) | v0.1.3 (frozen) |
| [api-server](https://github.com/fwmakc/api-server) | v0.9.0 |
| [gateway-server](https://github.com/fwmakc/gateway-server) | v0.6.0 (infra) |
| [api-server-scaffold](https://github.com/fwmakc/api-server-scaffold) | v0.1.5 |
