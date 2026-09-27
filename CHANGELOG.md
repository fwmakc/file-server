# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
