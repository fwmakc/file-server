import { Inject } from "@nestjs/common";
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Account, Self } from "api-server-toolkit";
import { AccountInfo } from "api-server-toolkit/auth-client";
import { Response } from "express";
import { AclService } from "../acl/acl.service";
import {
  FILES_STORAGE,
  IFileStorage,
  StorageNotFoundError,
} from "./storage.interface";
import { sanitizeRequestPath } from "./storage.utils";

// Inline disposition for cacheable public site assets only. SVG is
// deliberately absent — it can carry scripts and stays attachment.
const INLINE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  css: "text/css",
};

// Local storage keeps no content type — fall back to the key extension.
const EXT_TYPES: Record<string, string> = {
  ...INLINE_TYPES,
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  json: "application/json",
  html: "text/html",
  mp4: "video/mp4",
};

export const contentTypeFromKey = (key: string): string | undefined =>
  EXT_TYPES[(key.split(".").pop() || "").toLowerCase()];

const INLINE_MIME = new Set(Object.values(INLINE_TYPES));

const cacheTtl = (): number => {
  const ttl = Number(process.env.PUBLIC_CACHE_TTL);
  return ttl > 0 ? ttl : 300;
};

/**
 * Единственный путь отдачи файлов (оба режима хранения). Правила ACL
 * резолвятся здесь же: публичные префиксы отдаются анонимно и кэшируются,
 * всё остальное — только владельцу/грантам/staff, всегда с attachment.
 */
@ApiExcludeController()
@Controller(process.env.UPLOADS_URL || "uploads")
export class StorageDownloadController {
  constructor(
    @Inject(FILES_STORAGE) private readonly storage: IFileStorage,
    private readonly acl: AclService,
  ) {}

  // Token is OPTIONAL: a public prefix serves anonymous traffic; a missing
  // token yields the anonymous pseudo-account for the ACL check.
  @Account("noBlock")
  @Get("*splat")
  async download(
    // Express 5 (path-to-regexp v8) отдаёт wildcard параметром-массивом;
    // Nest приводит его к строке через join(",") — собираем сегменты обратно
    @Param("splat") path: string | string[],
    @Self() account: AccountInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const key = sanitizeRequestPath(
      Array.isArray(path) ? path.join("/") : path,
    );
    if (!key) {
      throw new NotFoundException();
    }

    const isPublic = await this.acl.isPublic(key);
    // 404 (not 403): existence of private objects must not leak.
    if (
      !isPublic &&
      !(await this.acl.canRead(key, account))
    ) {
      throw new NotFoundException();
    }

    let stored;
    try {
      stored = await this.storage.get(key);
    } catch (e) {
      if (e instanceof StorageNotFoundError) {
        throw new NotFoundException();
      }
      throw e;
    }

    const contentType = stored.contentType || contentTypeFromKey(key);
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    if (stored.contentLength) {
      res.setHeader("Content-Length", String(stored.contentLength));
    }
    // Inline by extension or by the exact MIME the storage layer reports —
    // both are matched against the same safe list.
    const ext = (key.split(".").pop() || "").toLowerCase();
    const inline =
      isPublic && (!!INLINE_TYPES[ext] || INLINE_MIME.has(contentType || ""));
    // attachment: загруженный пользователем файл (например, text/html)
    // не должен исполняться в origin-контексте при прямом открытии URL
    const filename = (key.split("/").pop() || "file")
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_");
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${filename}"`,
    );
    // Public site assets are cacheable end-to-end (nginx/CDN in front of
    // the gateway serves the hot path); private bytes must never be cached.
    res.setHeader(
      "Cache-Control",
      isPublic ? `public, max-age=${cacheTtl()}` : "private, no-store",
    );
    // клиент оборвал загрузку (close стреляет и после успешного конца) —
    // иначе s3-сокет висит до таймаута на каждый прерванный download
    res.on("close", () => {
      (stored.stream as { destroy?: () => void })?.destroy?.();
    });
    return new StreamableFile(stored.stream);
  }
}
