# File Server

File upload, image processing, PDF generation, and static file serving microservice.

Port **3002**. Part of the microservices split (Stage 6, Issue #6).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/files/upload` | JWT | Upload files (multipart form, field: `file`) |
| GET | `/uploads/*` | — | Static file serving |

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

## Port Assignments

| Service | Port |
|---------|------|
| auth-server | 3001 |
| **file-server** | **3002** |
| message-server | 3003 |
| chat-server | 3004 |
| event-server | 3005 |
| api-server | 5000 |
