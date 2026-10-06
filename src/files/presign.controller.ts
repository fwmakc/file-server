import { Inject } from "@nestjs/common";
import {
  Controller,
  NotImplementedException,
  NotFoundException,
  Post,
  Body,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { randomUUID } from "crypto";
import { Account, Self } from "api-server-toolkit";
import { AccountInfo } from "api-server-toolkit/auth-client";
import {
  asPresignable,
  FILES_STORAGE,
  IFileStorage,
} from "./storage/storage.interface";
import { sanitizeFolderPath, sanitizeRequestPath } from "./storage/storage.utils";
import { AclService } from "./acl/acl.service";
import { PresignUploadDto } from "./dto/presign_upload.files.dto";
import { PresignDownloadDto } from "./dto/presign_download.files.dto";
import { sanitizeFilename } from "./handler/save.handler";

/**
 * Ключ для presigned PUT генерирует сервер: uuid + санитизированное имя
 * внутри папки, разрешённой ACL (своя namespace или write-грант).
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
 * проверяет ACL (read на выдачу GET-ссылки, write на выдачу PUT-ссылки),
 * проверяет существование и генерирует ключи. Только для FILE_STORAGE=s3.
 */
@ApiExcludeController()
@Controller("files")
export class PresignController {
  constructor(
    @Inject(FILES_STORAGE) private readonly storage: IFileStorage,
    private readonly acl: AclService,
  ) {}

  @Account()
  @Post("presign/upload")
  async presignUpload(
    @Body() dto: PresignUploadDto,
    @Self() account: AccountInfo,
  ) {
    const presign = asPresignable(this.storage);
    if (!presign) {
      throw new NotImplementedException(
        "Presigned upload requires FILE_STORAGE=s3",
      );
    }
    // 403 when the folder is neither the account's namespace nor a
    // write-granted shared folder.
    const folder = await this.acl.resolveWriteFolder(dto?.folder ?? "", account);
    const key = buildPresignUploadKey(folder, dto?.filename);
    const { url, expiresIn } = await presign.presignedPut(key);
    return { url, key, expiresIn };
  }

  @Account()
  @Post("presign/download")
  async presignDownload(
    @Body() dto: PresignDownloadDto,
    @Self() account: AccountInfo,
  ) {
    const presign = asPresignable(this.storage);
    if (!presign) {
      throw new NotImplementedException(
        "Presigned download requires FILE_STORAGE=s3",
      );
    }
    const key = sanitizeRequestPath(dto?.key);
    // Owner/grant/staff (or public rule). 404 masks existence.
    if (
      !key ||
      !(await this.storage.exists(key)) ||
      !(await this.acl.canRead(key, account))
    ) {
      throw new NotFoundException();
    }
    const { url, expiresIn } = await presign.presignedGet(key);
    return { url, expiresIn };
  }
}
