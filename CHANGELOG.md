# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-09-29
### Changed
- Toolkit pinned to v0.20.2 (bootstrap binds 0.0.0.0 by default).

## [0.6.0] - 2026-09-29
### Added
- `IFileStorage` storage abstraction (`src/files/storage/`): `put` / `exists` / `get` / `delete`, backend selected by the `FILE_STORAGE` env (`local` default, `s3`).
- S3 backend (`S3Storage`, `@aws-sdk/client-s3` v3): any S3-compatible API — AWS S3, MinIO, Yandex Object Storage (`S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`) — required for horizontal scaling.
- In s3 mode a streaming download proxy serves objects at the same `UPLOADS_URL` prefix (replaces `ServeStaticModule`), so upload URLs are identical in both modes; `S3_PUBLIC_URL` (CDN / public bucket base) switches returned URLs to direct links and skips the proxy.
- `LocalStorage` (former inline fs logic of `SaveHandler`): mkdir-recursive on write, resolve-within-root defense, streaming reads.

### Changed
- `SaveHandler` writes through the storage abstraction instead of touching the filesystem directly; the "file already exists" check and the returned URL are backend-agnostic now.

### Fixed
- Local static serving returned 500 on missing files: `rootPath` was relative (`./public/uploads`) and `res.sendFile` requires an absolute path — now resolved at startup (404 as expected).

## [0.5.1] - 2026-09-28
### Changed
- Node.js runtime bumped 22 → 24 LTS: Docker images `node:24-alpine`, CI `node-version: 24`.
- `sharp` 0.32 → 0.34: 0.32 has no prebuilt binaries for Node 24 (native build hangs the Docker build on CI); 0.34 ships platform prebuilds incl. linuxmusl-x64.
- Toolkit pinned to `api-server-toolkit#v0.18.0` (adds `ApiKeyGuard` / `@ApiKey()`; no behavior change for existing routes).
- Dockerfile builds with explicit `npx tsc -p tsconfig.build.json` instead of `nest build` (the latter silently produced no `dist` under Node 24 + current CLI); added `tsconfig.build.json` excluding test files.

### Fixed
- Dockerfile: `COPY` of `.npmrc` used a path relative to the build-context root instead of `file-server/`, so the image could not build at all (`"/.npmrc": not found`).
- Toolkit peer dependencies `typeorm` and `@nestjs/typeorm` were not declared in this service (`npm install --legacy-peer-deps` does not auto-install peers) — the container crashed at boot with `Cannot find module 'typeorm'`.

## [0.5.0] - 2026-09-28

Security hardening release.

### Added
- `POST /files/upload` now requires a valid JWT (`@Account()`, RS256 via auth-server JWKS). Previously the endpoint was anonymous.

### Fixed
- Path traversal via `originalname`: file names are reduced to a sanitized basename (`../`, absolute paths and control characters are stripped); names reducing to `. `/`..` are rejected.
- `RenameHandler`: extension is reduced to alphanumeric characters (max 16) — path separators in the extension could escape the uploads folder.
- Dockerfile: `public/` directories are chowned to `node` (mkdir ran as root, writes could fail at runtime).
- Removed duplicate `ServeStaticModule` registration in `FilesModule` (`serveRoot` pointed to a filesystem path; `AppModule` already serves uploads at `UPLOADS_URL`).
- `Cors.setup` call updated for toolkit v0.17.0 allowlist semantics (`CORS_ORIGINS` env).

## [0.4.0] - 2026-08-03

Version reset to pre-release. The file server is functional (52 tests, uploads, image processing) but the overall stack is not yet production-hardened. Pinned to `api-server-toolkit#v0.9.0`.

## [2.0.0] - 2026-08-03

### Stack v2 alignment
- Major version aligned with api-server-toolkit v2.x
- Pinned to `api-server-toolkit#v2.1.0`
- File upload with type checking, size limits, image resize (Sharp)
- PDF generation via Puppeteer + EJS templates
- Static file serving
- 7 test suites, 52 tests
