#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Миграция local-хранилища → S3-бакет (Wave 5, FILE_STORAGE: local → s3).
//
// Обходит UPLOADS_PATH рекурсивно и кладёт каждый файл в бакет под тем же
// ключом (относительный путь) — object key совпадает с URL /uploads/...,
// ссылки в БД не ломаются. Content-Type выводится из расширения (минимальная
// карта + application/octet-stream по умолчанию).
//
// Идемпотентно: объект, уже существующий в бакете, пропускается — прерванный
// запуск можно просто повторить. Разница ключей local↔bucket выводится в
// dry-run.
//
// Usage (в env те же S3_* переменные, что и у file-server):
//   node scripts/migrate-to-s3.mjs                 # dry-run: только план
//   node scripts/migrate-to-s3.mjs --apply         # загрузить в бакет
//   node scripts/migrate-to-s3.mjs --apply --delete-local   # + удалить source
//
// Порядок на стенде: миграция --apply → переключить FILE_STORAGE=s3 →
// rolling restart; --delete-local только после проверки download'ов.
// ═══════════════════════════════════════════════════════════════
import { createRequire } from "module";
import { readdirSync, readFileSync, statSync, unlinkSync } from "fs";
import { join, relative, extname } from "path";

const require = createRequire(import.meta.url);
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".zip": "application/zip",
};

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DELETE_LOCAL = APPLY && args.includes("--delete-local");

const root = process.env.UPLOADS_PATH || "./public/uploads";
const bucket = process.env.S3_BUCKET;
if (!bucket) {
  console.error("S3_BUCKET is required");
  process.exit(1);
}

const client = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  ...(process.env.S3_FORCE_PATH_STYLE === "true"
    ? { forcePathStyle: true }
    : {}),
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
  // same as the runtime client (s3.storage.ts): SDK ≥3.729 defaults
  // (WHEN_SUPPORTED) add CRC32 headers that non-AWS buckets may reject
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

// Windows-пути → s3-ключи: всегда прямые слэши, без ведущего ./
const toKey = (absPath) =>
  relative(root, absPath).split(/[\\/]+/).filter(Boolean).join("/");

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

let files;
try {
  files = walk(root);
} catch (e) {
  console.error(`Cannot read ${root}: ${e.message}`);
  process.exit(1);
}

if (files.length === 0) {
  console.log(`No files under ${root} — nothing to migrate.`);
  process.exit(0);
}

console.log(
  `${APPLY ? "APPLY" : "DRY-RUN"}: ${files.length} file(s) → s3://${bucket}`,
);

let uploaded = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;

for (const file of files) {
  const key = toKey(file);
  const size = statSync(file).size;
  try {
    // идемпотентность: уже перенесённое не трогаем
    await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    skipped += 1;
    console.log(`  skip (exists) ${key}`);
    continue;
  } catch (e) {
    const err = e;
    const notFound =
      err?.name === "NotFound" ||
      err?.name === "NoSuchKey" ||
      err?.$metadata?.httpStatusCode === 404;
    if (!notFound) {
      failed += 1;
      console.error(`  FAIL (head)  ${key}: ${err.message}`);
      continue;
    }
  }

  if (!APPLY) {
    bytes += size;
    console.log(`  would put    ${key} (${size} bytes)`);
    continue;
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: readFileSync(file),
        ContentType:
          MIME[extname(file).toLowerCase()] || "application/octet-stream",
      }),
    );
    uploaded += 1;
    bytes += size;
    console.log(`  put          ${key} (${size} bytes)`);
    if (DELETE_LOCAL) {
      unlinkSync(file);
    }
  } catch (e) {
    failed += 1;
    console.error(`  FAIL (put)   ${key}: ${e.message}`);
  }
}

console.log(
  `\nDone: ${uploaded} uploaded, ${skipped} skipped (already in bucket), ${failed} failed` +
    (DELETE_LOCAL ? ", local sources deleted for uploaded keys" : ""),
);
if (!APPLY) {
  console.log("This was a dry-run — repeat with --apply to migrate.");
}
if (failed > 0) {
  process.exit(1);
}
