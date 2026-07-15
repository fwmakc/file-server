# File Server

File upload, image processing, PDF generation, and static file serving microservice.

Part of the fwmakc microservices split (Issue #6, Stage 6).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/files/upload` | Upload files (multipart form, field: `file`) |
| GET | `/uploads/*` | Static file serving |

## Environment

See `.env.example`. Key variables:

- `AUTH_SERVER_URL` — auth-server base URL for JWT verification via JWKS
- `UPLOADS_PATH` — filesystem path for uploaded files
- `UPLOADS_URL` — URL prefix for serving files
- `UPLOADS_MAX_SIZE` — max file size in bytes
- `UPLOADS_IMAGE_MAX_WIDTH` / `UPLOADS_IMAGE_MAX_HEIGHT` — auto-resize limits

## Development

```bash
cp .env.example .env
npm install
npm run dev
```
