import { Logger } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import {
  IFileStorage,
  PresignedUrl,
  StorageNotFoundError,
  StoredObject,
} from "./storage.interface";

// Bucket-unreachable must fail fast, not hang the request handler: these
// timeouts bound every SDK call (S3_ENDPOINT is internal wire, the bucket
// is one hop away).
const S3_REQUEST_TIMEOUT_MS = 30_000;
const S3_CONNECT_TIMEOUT_MS = 5_000;

const presignExpiresSec = (): number => {
  const value = Number(process.env.S3_PRESIGN_EXPIRES_SEC);
  return Number.isFinite(value) && value > 0 ? value : 900;
};

export class S3Storage implements IFileStorage {
  private readonly client: S3Client;

  // Presigned URLs go to the CLIENT — the bucket must be reachable at that
  // endpoint (edge subdomain in production, published port in dev). SigV4
  // covers the host, so a different endpoint means a separate signer client;
  // file-server's own traffic keeps using S3_ENDPOINT.
  private readonly presignClient: S3Client;

  private readonly bucket: string;

  constructor(client?: S3Client, presignClient?: S3Client) {
    this.client = client ?? S3Storage.clientFromEnv();
    this.presignClient = presignClient ?? S3Storage.presignClientFromEnv();
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

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    // The presign endpoint serves BROWSERS, not this process — a dead edge
    // host breaks every client-side upload while this endpoint looks fine.
    // Probe the signer path too, but only warn: a segmented network keeps it
    // unreachable from this container by design (dev published port binds the
    // host loopback), and /health/storage must reflect what THIS process
    // can serve.
    if (process.env.S3_PRESIGN_ENDPOINT) {
      try {
        await this.presignClient.send(
          new HeadBucketCommand({ Bucket: this.bucket }),
        );
      } catch (e) {
        new Logger(S3Storage.name).warn(
          `Presign endpoint unreachable from this process (clients may still reach it): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }

  async presignedPut(key: string): Promise<PresignedUrl> {
    const expiresIn = presignExpiresSec();
    const url = await getSignedUrl(
      this.presignClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
    return { url, expiresIn };
  }

  async presignedGet(key: string): Promise<PresignedUrl> {
    const expiresIn = presignExpiresSec();
    // Uploaded content must never execute in the bucket's origin context:
    // the attachment disposition is part of the signed URL.
    const url = await getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: 'attachment; filename="download"',
      }),
      { expiresIn },
    );
    return { url, expiresIn };
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
      requestHandler: {
        requestTimeout: S3_REQUEST_TIMEOUT_MS,
        connectionTimeout: S3_CONNECT_TIMEOUT_MS,
      },
      // SDK ≥3.729 default (WHEN_SUPPORTED) embeds a CRC32 of the unknown
      // body into presigned URLs — the real upload would then fail checksum
      // validation at the bucket. Only send checksums when required.
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  }

  private static presignClientFromEnv(): S3Client {
    const endpoint = process.env.S3_PRESIGN_ENDPOINT || process.env.S3_ENDPOINT;
    if (!endpoint) return this.clientFromEnv();
    return new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint,
      ...(process.env.S3_FORCE_PATH_STYLE === "true"
        ? { forcePathStyle: true }
        : {}),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      // The default (WHEN_SUPPORTED) puts x-amz-checksum-mode=ENABLED into
      // presigned GET queries — SeaweedFS's SigV4 verification rejects such
      // URLs with SignatureDoesNotMatch. Presigned URLs must stay minimal.
      responseChecksumValidation: "WHEN_REQUIRED",
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
