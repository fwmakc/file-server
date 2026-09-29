import { Readable } from "stream";

export const FILES_STORAGE = "FILES_STORAGE";

export interface StoredObject {
  stream: Readable;

  contentLength?: number;

  contentType?: string;
}

export interface IFileStorage {
  put(key: string, buffer: Buffer, contentType?: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  get(key: string): Promise<StoredObject>;

  delete(key: string): Promise<void>;
}

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Storage object not found: ${key}`);
    this.name = "StorageNotFoundError";
  }
}
