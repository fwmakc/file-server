import { Injectable } from "@nestjs/common";
import { FilesInterface } from "@src/files/files.interface";
import { v4 } from "uuid";

@Injectable()
export class RenameHandler {
  rename(file: FilesInterface, extension = undefined) {
    if (!extension) {
      const { originalname } = file;
      extension = originalname.split(".").pop();
    }
    // Только буквенно-цифровой хвост — слэши/точки в расширении дают traversal
    const ext = String(extension)
      .replace(/[^\w]/gu, "")
      .slice(0, 16);
    const name = v4();
    return new FilesInterface({
      buffer: file.buffer,
      originalname: ext ? `${name}.${ext}` : name,
      mimetype: file.mimetype,
      size: file.size,
    });
  }
}
