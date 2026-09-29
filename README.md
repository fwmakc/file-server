# File Server

[![Tests](https://github.com/fwmakc/file-server/actions/workflows/test.yml/badge.svg)](https://github.com/fwmakc/file-server/actions/workflows/test.yml)
[![Version](https://img.shields.io/badge/version-v0.4.0-blue)](https://github.com/fwmakc/file-server/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](https://github.com/fwmakc/file-server/blob/master/LICENSE)

> Reference implementation: stateless service pattern — uploads, image processing, PDF generation, no database.

## What This Is

A working scaffold for file handling — upload, validation, image resize/convert, and PDF
generation from EJS templates. Part of a
[microservices stack](https://github.com/fwmakc/gateway-server).

## Role in the stack

```
client → nginx → file-server (upload, download)
file-server → auth-server (JWT verification via JWKS)
file-server → local filesystem (uploads volume)
```

**Dependencies:** auth-server (JWT, optional — upload endpoint currently unauthenticated)
**Dependents:** nginx (routes `/files`, `/uploads`)

## Pattern

This service demonstrates the **stateless service pattern** in the toolkit stack:

- **No database** — no TypeORM connection, no entities, no migrations
- **Stateless** — horizontally scalable, any instance handles any request
- **Stream processing** — file upload via multipart, image resize via sharp
- **Template rendering** — PDF generation from EJS templates

Clone this when you need: file handling, media processing, document generation, any stateless workload.

## Quick start

```bash
cp .env.example .env
npm install --legacy-peer-deps
npm run dev
```

## API reference

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/files/upload` | Upload files (multipart/form-data) |
| GET | `/uploads/* | Static file serving |

### Upload example

```bash
curl -X POST http://localhost:3002/files/upload \
  -F "file=@photo.jpg" \
  -F 'options={"resize":{"width":800},"convertToWebp":true};type=application/json'
```

### Upload options

Options are passed as JSON in the `options` form field:

| Option | Type | Description |
|--------|------|-------------|
| `resize` | `{width?, height?}` | Resize image (preserves aspect ratio) |
| `convertToWebp` | boolean | Convert image to WebP format |
| `maxSize` | number | Max file size in bytes |
| `allowTypes` | string[] | Allowed MIME types |

## Configuration (.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3002 | HTTP port |
| `FILE_STORAGE` | local | Storage backend: `local` or `s3` |
| `UPLOADS_PATH` | ./public/uploads | Storage directory (local backend) |
| `UPLOADS_URL` | /uploads | Public URL prefix (static serving in local mode, download proxy in s3 mode) |
| `S3_BUCKET` | — | Bucket name (required in s3 mode) |
| `S3_REGION` | us-east-1 | S3 region |
| `S3_ENDPOINT` | — | Custom endpoint (MinIO, Yandex Object Storage, …) |
| `S3_ACCESS_KEY_ID` | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | — | S3 secret key |
| `S3_FORCE_PATH_STYLE` | false | `true` for MinIO-style path addressing (`endpoint/bucket/key`) |
| `S3_PUBLIC_URL` | — | Absolute base returned in upload URLs (CDN / public bucket); unset = serve via file-server proxy |
| `UPLOADS_MAX_SIZE` | 1048576 | Max upload size (bytes) |
| `UPLOADS_ALLOW_TYPES` | — | Comma-separated MIME types |
| `UPLOADS_IMAGE_MAX_WIDTH` | 3840 | Max image width before resize |
| `UPLOADS_IMAGE_MAX_HEIGHT` | 2160 | Max image height |
| `AUTH_SERVER_URL` | http://localhost:3001 | Auth server for JWT verification |

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

- **`local`** (default) — files under `UPLOADS_PATH`, served statically by
  `ServeStaticModule` at `UPLOADS_URL`. Single-instance only: the disk is
  ephemeral per container unless you mount a shared volume.
- **`s3`** — files stored in any S3-compatible API (AWS S3, MinIO,
  Yandex Object Storage). Required for horizontal scaling: all instances
  see the same data and containers stay stateless.

In s3 mode the `ServeStaticModule` is replaced by a streaming download
proxy at the same `UPLOADS_URL` prefix, so object URLs are identical in
both modes (`/uploads/<folder>/<file>`). Set `S3_PUBLIC_URL` (CDN or a
public bucket base) to return direct URLs and skip the proxy entirely.

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

All services in the fwmakc stack share the same **major version**. Same major = guaranteed compatibility.

| Level | Scope | Example |
|-------|-------|---------|
| **Major** | Shared across ALL services. A breaking change in any service bumps the major for everyone. | toolkit 2.x → 3.0.0 ⟹ all services tag v3.0.0 |
| **Minor** | Independent per service. New features (additive). | auth-server 2.1.0 → 2.2.0 |
| **Patch** | Independent per service. Bug fixes. | event-server 2.0.0 → 2.0.1 |

### What triggers a major bump

A breaking change at any intersection point:

- **api-server-toolkit** — guards, columns, decorators, EntityController, bootstrap, services
- **event-server contracts** — DTO field removed/renamed, required field added
- **Inter-service API** — JWT claim format, `X-Internal-Api-Key` scheme, webhook contract
- **Public API** — any endpoint that another service depends on

### What does NOT trigger a major bump

- Bug fixes, performance improvements
- New features (additive — new optional fields, new endpoints)
- Internal refactoring that doesn't change interfaces

### Alignment process

When a service makes a breaking change (e.g., toolkit 2.x → 3.0.0):

1. The changing service bumps its major and tags the release
2. **All other services** get a stack alignment commit:
   - Bump `version` in `package.json`
   - Add CHANGELOG entry: `chore: stack v3 alignment`
   - Update dependency pins if needed
   - Tag `v3.0.0`
3. All services are now on stack v3

### Current versions

| Service | Version |
|---------|---------|
| [api-server-toolkit](https://github.com/fwmakc/api-server-toolkit) | v2.1.0 |
| [event-server](https://github.com/fwmakc/event-server) | v2.0.0 |
| [auth-server](https://github.com/fwmakc/auth-server) | v2.0.0 |
| [message-server](https://github.com/fwmakc/message-server) | v2.0.0 |
| [file-server](https://github.com/fwmakc/file-server) | v2.0.0 |
| [chat-server](https://github.com/fwmakc/chat-server) | v2.0.0 |
| [api-server](https://github.com/fwmakc/api-server) | v2.0.0 |
| [gateway-server](https://github.com/fwmakc/gateway-server) | v2.0.0 |
| [scaffold](https://github.com/fwmakc/scaffold) | v2.0.0 |
