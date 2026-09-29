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
import { Response } from "express";
import {
  FILES_STORAGE,
  IFileStorage,
  StorageNotFoundError,
} from "./storage.interface";
import { sanitizeRequestPath } from "./storage.utils";

/**
 * Отдача файлов из хранилища в том же URL-пространстве, что и статика
 * в local-режиме (UPLOADS_URL). Регистрируется только при FILE_STORAGE=s3.
 */
@ApiExcludeController()
@Controller(process.env.UPLOADS_URL || "uploads")
export class StorageDownloadController {
  constructor(
    @Inject(FILES_STORAGE) private readonly storage: IFileStorage
  ) {}

  @Get("*splat")
  async download(
    // Express 5 (path-to-regexp v8) отдаёт wildcard параметром-массивом;
    // Nest приводит его к строке через join(",") — собираем сегменты обратно
    @Param("splat") path: string | string[],
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const key = sanitizeRequestPath(
      Array.isArray(path) ? path.join("/") : path
    );
    if (!key) {
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

    if (stored.contentType) {
      res.setHeader("Content-Type", stored.contentType);
    }
    if (stored.contentLength) {
      res.setHeader("Content-Length", String(stored.contentLength));
    }
    return new StreamableFile(stored.stream);
  }
}
