import { createReadStream } from "fs";
import { access, mkdir, rm, stat, writeFile } from "fs/promises";
import { dirname, resolve, sep } from "path";
import {
  IFileStorage,
  StorageNotFoundError,
  StoredObject,
} from "./storage.interface";

export class LocalStorage implements IFileStorage {
  constructor(
    private readonly root: string = process.env.UPLOADS_PATH || "./public/uploads"
  ) {}

  async put(key: string, buffer: Buffer): Promise<void> {
    const filePath = this.resolve(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<StoredObject> {
    const filePath = this.resolve(key);
    try {
      const file = await stat(filePath);
      return { stream: createReadStream(filePath), contentLength: file.size };
    } catch {
      throw new StorageNotFoundError(key);
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  private resolve(key: string): string {
    const rootPath = resolve(this.root);
    const fullPath = resolve(rootPath, key);
    if (fullPath !== rootPath && !fullPath.startsWith(rootPath + sep)) {
      throw new StorageNotFoundError(key);
    }
    return fullPath;
  }
}
