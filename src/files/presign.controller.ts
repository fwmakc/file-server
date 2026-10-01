import { Inject, Injectable } from "@nestjs/common";
import {
  Controller,
  Get,
  NotImplementedException,
  NotFoundException,
  Post,
  Body,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { randomUUID } from "crypto";
import { Account } from "api-server-toolkit";
import {
  asPresignable,
  FILES_STORAGE,
  IFileStorage,
} from "./storage/storage.interface";
import { isS3Storage } from "./storage/storage.module";
import { sanitizeFolderPath, sanitizeRequestPath } from "./storage/storage.utils";
import { PresignUploadDto } from "./dto/presign_upload.files.dto";
import { PresignDownloadDto } from "./dto/presign_download.files.dto";
import { sanitizeFilename } from "./handler/save.handler";

/**
 * Ключ для presigned PUT генерирует сервер: uuid + санитизированное имя.
 * Клиент никогда не выбирает ключ — перезапись чужих объектов и перебор
 * имён невозможны по построению.
 */
export const buildPresignUploadKey = (
  folder: unknown,
  filename: unknown,
): string => {
  const name = sanitizeFilename(filename) || "file";
  return [sanitizeFolderPath(folder), `${randomUUID()}-${name}`]
    .filter(Boolean)
    .join("/");
};

/**
 * Presigned URLs: клиент ходит в бакет напрямую (PUT вверх, GET вниз),
 * file-server остаётся единственным эмиттером — аутентифицирует (@Account),
 * проверяет существование и генерирует ключи. Только для FILE_STORAGE=s3.
 */
@ApiExcludeController()
@Controller("files")
export class PresignController {
  constructor(@Inject(FILES_STORAGE) private readonly storage: IFileStorage) {}

  @Account()
  @Post("presign/upload")
  async presignUpload(@Body() dto: PresignUploadDto) {
    const presign = asPresignable(this.storage);
    if (!presign) {
      throw new NotImplementedException(
        "Presigned upload requires FILE_STORAGE=s3",
      );
    }
    const key = buildPresignUploadKey(dto?.folder, dto?.filename);
    const { url, expiresIn } = await presign.presignedPut(key);
    return { url, key, expiresIn };
  }

  @Account()
  @Post("presign/download")
  async presignDownload(@Body() dto: PresignDownloadDto) {
    const presign = asPresignable(this.storage);
    if (!presign) {
      throw new NotImplementedException(
        "Presigned download requires FILE_STORAGE=s3",
      );
    }
    const key = sanitizeRequestPath(dto?.key);
    if (!key || !(await this.storage.exists(key))) {
      throw new NotFoundException();
    }
    const { url, expiresIn } = await presign.presignedGet(key);
    return { url, expiresIn };
  }
}
