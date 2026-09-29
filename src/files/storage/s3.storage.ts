import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import {
  IFileStorage,
  StorageNotFoundError,
  StoredObject,
} from "./storage.interface";

export class S3Storage implements IFileStorage {
  private readonly client: S3Client;

  private readonly bucket: string;

  constructor(client?: S3Client) {
    this.client = client ?? S3Storage.clientFromEnv();
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      throw new Error("S3_BUCKET is required when FILE_STORAGE=s3");
    }
    this.bucket = bucket;
  }

  async put(key: string, buffer: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ...(contentType ? { ContentType: contentType } : {}),
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (e) {
      if (this.isNotFound(e)) return false;
      throw e;
    }
  }

  async get(key: string): Promise<StoredObject> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        stream: response.Body as Readable,
        contentLength: response.ContentLength,
        contentType: response.ContentType,
      };
    } catch (e) {
      if (this.isNotFound(e)) throw new StorageNotFoundError(key);
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  private static clientFromEnv(): S3Client {
    return new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
      ...(process.env.S3_FORCE_PATH_STYLE === "true"
        ? { forcePathStyle: true }
        : {}),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      },
    });
  }

  private isNotFound(e: unknown): boolean {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    return (
      err?.name === "NotFound" ||
      err?.name === "NoSuchKey" ||
      err?.$metadata?.httpStatusCode === 404
    );
  }
}
