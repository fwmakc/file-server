import { Injectable } from "@nestjs/common";
import { access, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { FilesInterface } from "../files.interface";
import { OptionsFilesDto } from "../dto/options.files.dto";

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
  async save(file: FilesInterface, options: OptionsFilesDto) {
    let { folder } = options;
    const { replace } = options;

    folder = `${folder || ""}`.replace(/[^\w\d\/]/gu, "");

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

    const uploadFolder = join(process.env.UPLOADS_PATH, folder);

    try {
      await access(uploadFolder);
    } catch (e) {
      await mkdir(uploadFolder, { recursive: true });
    }

    const filePath = join(uploadFolder, filename);

    if (!replace && existsSync(filePath)) {
      return {
        error: "Файл уже существует",
      };
    }

    try {
      await writeFile(filePath, file.buffer);
    } catch (e) {
      return {
        error: "Ошибка при записи файла",
      };
    }

    return {
      url: `${process.env.UPLOADS_URL}/${folder ? `${folder}/` : ""}${filename}`,
    };
  }
}
