import { Readable } from "stream";

export const FILES_STORAGE = "FILES_STORAGE";

export interface StoredObject {
  stream: Readable;

  contentLength?: number;

  contentType?: string;
}

export interface PresignedUrl {
  url: string;

  expiresIn: number;
}

export interface IFileStorage {
  put(key: string, buffer: Buffer, contentType?: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  get(key: string): Promise<StoredObject>;

  delete(key: string): Promise<void>;

  // Reachability probe for /health/storage (LocalStorage resolves instantly).
  ping(): Promise<void>;
}

// Capability interface: only object stores can hand out presigned URLs —
// the download controller streams instead, so local mode answers 501 on the
// presign routes.
export interface IPresignableStorage {
  // No contentType parameter: @aws-sdk/s3-request-presigner hardcodes
  // content-type as unsignable, so it can never be pinned into a presigned
  // PUT. The client MAY send Content-Type on PUT — the bucket stores what
  // arrives; downloads are forced to attachment disposition either way.
  presignedPut(key: string): Promise<PresignedUrl>;

  presignedGet(key: string): Promise<PresignedUrl>;
}

export const asPresignable = (
  storage: IFileStorage,
): IPresignableStorage | null =>
  typeof (storage as Partial<IPresignableStorage>).presignedPut === "function"
    ? (storage as unknown as IPresignableStorage)
    : null;

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Storage object not found: ${key}`);
    this.name = "StorageNotFoundError";
  }
}
