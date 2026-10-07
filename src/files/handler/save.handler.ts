import { Inject, Injectable } from "@nestjs/common";
import { FilesInterface } from "../files.interface";
import { OptionsFilesDto } from "../dto/options.files.dto";
import { FILES_STORAGE, IFileStorage } from "../storage/storage.interface";
import { isS3Storage } from "../storage/storage.module";
import { sanitizeFolderPath } from "../storage/storage.utils";
import { AclService } from "../acl/acl.service";

/**
 * Оставляет только имя файла: любой путь (../, абсолютные пути, слэши)
 * отбрасывается, управляющие символы удаляются. Пустая строка для '.',
 * '..' и имён без файловой части.
 */
export const sanitizeFilename = (name: unknown): string => {
  const base = String(name ?? "")
    .split(/[\\/]+/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim();
  return base === "." || base === ".." ? "" : base;
};

@Injectable()
export class SaveHandler {
  constructor(
    @Inject(FILES_STORAGE) private readonly storage: IFileStorage,
    private readonly acl: AclService,
  ) {}

  async save(file: FilesInterface, options?: OptionsFilesDto) {
    const { replace } = options ?? {};
    const folder = sanitizeFolderPath(options?.folder);

    if (!file) {
      return {
        error: "Файл не задан",
      };
    }

    const filename = sanitizeFilename(file.originalname);
    if (!filename) {
      return {
        error: "Некорректное имя файла",
      };
    }

    const key = [folder, filename].filter(Boolean).join("/");

    try {
      if (!replace && (await this.storage.exists(key))) {
        return {
          error: "Файл уже существует",
        };
      }

      await this.storage.put(key, file.buffer, file.mimetype);
    } catch (e) {
      return {
        error: "Ошибка при записи файла",
      };
    }

    return {
      url: `${await this.urlBase(key)}/${key}`,
    };
  }

  /**
   * База публичных URL: при S3 с настроенным S3_PUBLIC_URL (CDN/публичный
   * бакет) отдача идёт мимо file-server, поэтому CDN-ссылка выдаётся только
   * для ключей, которые правило ACL уже сделало публичными; приватные
   * объекты всегда получают DOWNLOAD-роут (UPLOADS_URL) — край с проверкой
   * прав, даже если правило опубликуют позже.
   */
  private async urlBase(key: string): Promise<string> {
    const cdn =
      isS3Storage() && process.env.S3_PUBLIC_URL
        ? process.env.S3_PUBLIC_URL.replace(/\/+$/u, "")
        : null;
    if (cdn && (await this.acl.isPublic(key))) {
      return cdn;
    }
    return (process.env.UPLOADS_URL || "/uploads").replace(/\/+$/u, "");
  }
}
