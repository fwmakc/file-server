# File Server

> File upload, image processing, and PDF generation service.

## What is this?

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
| `UPLOADS_PATH` | ./public/uploads | Storage directory |
| `UPLOADS_URL` | /uploads | URL prefix for static serving |
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

## Migration: replace with S3/MinIO

When you outgrow local storage:
1. Replace `SaveHandler` with S3 upload logic
2. Replace `ServeStaticModule` with S3 presigned URLs
3. Consider Lambda for image processing (offload from Node.js)

## Related services

- [auth-server](https://github.com/fwmakc/auth-server) — JWT verification
- [gateway-server](https://github.com/fwmakc/gateway-server) — Docker Compose, Nginx
