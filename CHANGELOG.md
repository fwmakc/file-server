# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-10-06
### Added — file ownership & ACL (Wave 12)
- **file-server теперь сам владеет авторизацией файлов.** Анонимный доступ к байтам закрыт: отдача — только через `StorageDownloadController` (serve-static убран, «неохраняемого статического пути» больше нет), загрузка — только с JWT. Модель (в духе Google Drive, но на префиксах):
  - ключи живут под **namespace аккаунта** `<accountId>/…` — рут клейтмится из токена, клиент его не выбирает;
  - всё **private by default**: читать могут владелец, staff и явно перечисленные гранты; чужой приватный ключ отвечает **404** (существование не раскрывается);
  - **ACL-правило** (`file_acl`) — на точный ключ файла или префикс папки (trailing slash): `visibility` (`private`|`public`) + **гранты** (`file_acl_grants`) `u:<accountId>` / `r:<role>` с режимом `read`|`write` (write влечёт read);
  - **longest-prefix-wins**: самое длинное совпадение определяет правило (приватный оверрайд внутри публичного дерева работает);
  - **staff** (`isSuperuser`, `admin`, `editor`) — глобальный bypass; legacy-ключи (вне namespace и без правила) — staff-only по построению;
  - запись в общий префикс = write-грант на объемлющее правило; `visibility: public` — анонимное чтение с `Cache-Control: public, max-age=PUBLIC_CACHE_TTL` (default 300 — nginx/CDN кэшируют «горячий» путь) и inline-отдачей только для безопасных растровых типов/шрифтов/css (SVG исключён — XSS); приватное — всегда `attachment` + `private, no-store`.
- **Роли приходят из auth-server**: access-JWT несёт только `{id, type}`; `AuthClientService.getAccountInfo` (internal call, LRU-кэш 30 с) обогащает аккаунт ролями и `isSuperuser`. `AuthClientModule.forRoot()` регистрирует паспорт-стратегию `jwt` (RS256/JWKS + `getAccountInfo`) — собственный `JwtStrategy` file-server удалён; bonus: mfa-токены и деактивированные аккаунты отклоняются на всех роутах.
- **Гранты валидируются**: `accountId` гранта проверяется через auth internal-info — несуществующий аккаунт → 400 (список неизвестных id).
- **Новые роуты**: `POST /files/acl` (создать/обновить правило; гранты заменяются wholesale; автор — staff или владелец namespace), `GET /files/acl/*` (инспекция самого длинного действующего правила; 404 без read-доступа), `DELETE /files/*` (exists → canWrite → удалить объект и правила под ним; 404 маскирует).
- **user.deleted по шине**: file-server подписывается на event-server (подпись `WEBHOOK_SECRET`, ledger `webhook_processed_events` — идемпотентность по `eventId`, повторная доставка — no-op) и вычищает гранты удалённого аккаунта в той же транзакции, что и запись в ledger. `EVENT_SERVER_URL=disabled` выключает подписку (для dev/тестов).
- **Postgres**: сервис больше не stateless — `file_acl`, `file_acl_grants`, `webhook_processed_events`; boot-миграции под advisory-lock (`runMigrationsUnderLock`), `DB_*` обязательны.

### Breaking
- **Требуется БД** (`DB_TYPE/HOST/PORT/NAME/USER/PASSWORD`) — gateway compose и `init-databases.sh` обновлены (БД `file_server`).
- **Ключи загрузок сменили форму**: новые объекты попадают под `<accountId>/…`; существующие ссылки на старые ключи останутся рабочими только для staff — публичные данные нужно перенести под public-правило (`POST /files/acl`, `visibility: public`).
- Папка назначения `options.folder` вне namespace требует write-гранта (403), а не молча создавала путь.

### Tests
- 170 тестов (18 сьютов): матрица решений AclService против реального Postgres (22), оба прод-паттерна через настоящий HTTP-стек с подписанными тестовыми токенами — public site-assets (анонимный inline/cacheable download, role-гранты авторов, svg-безопасность) и personal documents (владелец/staff/чужой 404, read / read+write / read+write+delete, шаринг папки) (18), webhooks ledger + purge (4), subscriber retry/disabled, download-контроллер (inline/cache/no-store/content-type) и e2e-роут. Wiring: 15 проб реального бута, включая ACL-контур.

### Infra
- CI: тестовый job поднимает Postgres и создаёт `file_server_test`; wiring-job получил postgres-сервис и `INTERNAL_API_KEY`; docker-build резолвит `EVENTSERVER_REF` и чекаутит event-server сиблингом (контракты закоммичены).
- Dockerfile: стаб-механизм git-зависимостей расширен на `event-server/contracts` + фантом-защита (`rm -rf node_modules/api-server-toolkit node_modules/event-server` перед COPY исходников).

### Tests (0.7-волна)
- **Wiring-проверка реального бута** (`scripts/wiring.ts`, `npm run test:wiring`): поднимает настоящий `AppModule` в контексте приложения, затем живые пробы пайплайна `FilesService.process` на локальном хранилище во временном каталоге: сохранение + чтение байтов с диска, traversal-санитизация (`../../etc/evil.txt` не выходит за uploads), изоляция батча (битый файл даёт per-file error и не роняет соседние), точные токены `UPLOADS_ALLOW_TYPES` (svg+xml отклонён, png пропущен), ACL-контур (namespace, public-префикс, гранты, longest-match). 15/15 проверок, exit code для CI. Скрипт идёт с `ts-node --transpile-only` (типы sharp 0.35 не компилируются ts-node). Требует `DB_*` (boot-миграции).
- CI: job `wiring`.

## [0.7.4] - 2026-10-01
### Security (Wave 6)
- **`UPLOADS_ALLOW_TYPES` now matches exact tokens** (split on `;,|` and whitespace, case-insensitive): прежняя подстрочная проверка означала, что `image/png` в списке неявно пускал ВСЁ `image/*` — включая `image/svg+xml` (stored XSS через загруженный svg), а `text` — `text/html`. Полный mimetype, major-группа (`image`) и subtype (`png`) — три отдельных точных токена. Внимание при апгрейде: списки вида `image/png;jpeg` теперь буквально требуют точного совпадения — при необходимости добавить группу (`image`) явно.
- **`/health/storage` не отдаёт наружу текст ошибки** (детали бакета/эндпоинта — в лог сервера, в теле 503 — общий `storage unreachable`): эндпоинт доступен без аутентификации.
- **`ping()` проверяет и presign-эндпоинт**, когда задан `S3_PRESIGN_ENDPOINT`: он обслуживает браузеры, и его падение ломало все клиентские загрузки при «зелёном» /health/storage.

### Fixed
- **Сбой sharp на одном файле больше не роняет весь батч** (`POST /files/upload`): битый/не поддерживаемый образ возвращал 500 на весь запрос; теперь файл получает персональную запись с `error`, остальные загружаются.
- **S3-стрим освобождается при обрыве клиента** (`GET /uploads/*`): `res.close` уничтожает стрим — иначе сокет к бакету висел до таймаута на каждый прерванный download.
- **`migrate-to-s3.mjs` получил те же checksum-параметры клиента**, что и рантайм (`WHEN_REQUIRED`) — миграция в не-AWS бакеты падала на CRC-заголовках SDK ≥3.729.

### Tests
- allow-types: токен полного mimetype не открывает группу (svg/jpeg против `image/png`), case-insensitivity; files.service: изоляция сбоя в батче; download: destroy по close; s3.storage: ping проверяет оба эндпоинта. 118/118.

## [0.7.3] - 2026-10-01
### Fixed
- **Presigned GET отклонялся SeaweedFS (SignatureDoesNotMatch)**: SDK по умолчанию (`WHEN_SUPPORTED`) добавляет `x-amz-checksum-mode=ENABLED` в query presigned GET — SigV4-верификация SeaweedFS 3.80 такие URL отвергает (параметры `UNSIGNED-PAYLOAD`, `x-id` и `response-content-disposition` проверены — безвредны). На presign-клиенте выставлены `requestChecksumCalculation`/`responseChecksumValidation: WHEN_REQUIRED`; регресс-тест на отсутствие checksum-параметров в URL.

## [0.7.2] - 2026-10-01
### Fixed
- **Presign-роуты возвращали 400 на любое тело**: ValidationPipe (whitelist + forbidNonWhitelisted) отвергает поля без валидационных декораторов — `filename`/`folder`/`key` в presign-DTO были голыми. Добавлены `@IsString`/`@MaxLength` (+ `@IsOptional` для folder); живая проверка на стенде (smoke, шаги 8–10).

## [0.7.1] - 2026-10-01
### Added
- `scripts/migrate-to-s3.mjs` — перенос local-хранилища (`UPLOADS_PATH`) в бакет под теми же ключами (URL в БД не ломаются); dry-run по умолчанию, `--apply`, `--delete-local`; идемпотентен (существующие объекты пропускаются). Host-side утилита, в образ не входит.

## [0.7.0] - 2026-10-01
### Added
- **Presigned URLs** (Wave 5 S3/MinIO): `POST /files/presign/upload` и `POST /files/presign/download` (только `FILE_STORAGE=s3`, иначе 501; требуется JWT). Ключ аплоада генерирует сервер (`folder/<uuid>-<sanitized-name>`) — клиент никогда не выбирает ключ, перезапись чужих объектов невозможна по построению. `S3_PRESIGN_ENDPOINT` — внешний endpoint для подписи (SigV4 покрывает Host; трафик file-server↔бакет остаётся на `S3_ENDPOINT`), `S3_PRESIGN_EXPIRES_SEC` (default 900). Presigned GET всегда содержит `ResponseContentDisposition: attachment`.
- **Известное ограничение**: presigned PUT не пинит Content-Type — `@aws-sdk/s3-request-presigner` жёстко добавляет его в unsignable; клиент шлёт свой Content-Type, бакет сохраняет присланный. Presigned POST policy (content-length-range) AWS SDK v3 не поддерживает.
- `GET /health/storage` — доступность хранилища (S3: HeadBucket; local — всегда ok) с указанием активного бэкенда.
- Boot-check хранилища: при старте пинг, недоступный бакет пишется в лог ошибкой (не крешит приложение).
- `MAX_UPLOAD_SIZE` (МБ, default 50) — потолок multer на `POST /files/upload` (Nest отдаёт 413 при превышении).
- Таймауты S3-клиента: 30 с на запрос, 5 с на соединение — недоступный бакет не подвешивает хендлеры.

### Changed
- Новая зависимость: `@aws-sdk/s3-request-presigner` ^3.1142.0.
- Отключено дефолтное CRC32-чексуммирование SDK (`requestChecksumCalculation: WHEN_REQUIRED`) — без этого SDK ≥3.729 вшивает чексумму пустого тела в presigned URL и реальный PUT падает на валидации.

## [0.6.4] - 2026-09-30
### Fixed
- **Заголовок `Content-Disposition: attachment` в StorageDownloadController** (self-pentest): загруженный пользователем файл (например, `text/html`) при прямом открытии S3-URL больше не исполняется в origin-контексте браузера; имя файла вычищается до ASCII-безопасного (не-ASCII и кавычки → `_`), так что инъекция заголовка невозможна.
- **500 на отклонённом аплоаде** (self-pentest): файл, отклонённый фильтрами размера/типа, возвращал `undefined` из `fileProcess`, и деструктуризация его полей роняла весь запрос в 500. Теперь в ответе — запись с `error` «Файл отклонён…», остальные файлы в запросе обрабатываются.

### Changed
- Toolkit pinned `#v0.22.0` (self-pentest wave 4: Access-binds fail-closed, delete tenant guards, scoped movePosition, search relation clamp, `getClientIp()`/`TRUST_PROXY`).

## [0.6.3] - 2026-09-30
### Added
- `AuditModule.forRoot()` (toolkit 0.21.1): uploads and other successful mutations (non-GET 2xx) are audited as `data.created` / `data.updated` / `data.deleted` and 403s as `access.denied`, published to event-server 0.8.0's tamper-evident `audit_events` store.

### Changed
- Pin: toolkit `#v0.21.1`.

## [0.6.2] - 2026-09-29
### Changed
- Toolkit pinned to v0.20.3 (QueueWorker claim: Postgres forbids FOR UPDATE on the nullable side of an outer join — relations are now hydrated by a second lock-free query inside the claim transaction).

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
