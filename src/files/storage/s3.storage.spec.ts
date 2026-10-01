import { Readable } from "stream";
import { text } from "stream/consumers";
import { S3Storage } from "./s3.storage";
import { StorageNotFoundError } from "./storage.interface";

const notFound = (shape: object) =>
  Object.assign(new Error("not found"), shape);

describe("S3Storage", () => {
  let send: jest.Mock;
  let storage: S3Storage;
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_REGION = "us-east-1";
    send = jest.fn();
    storage = new S3Storage({ send } as any);
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("throws without S3_BUCKET", () => {
    delete process.env.S3_BUCKET;
    expect(() => new S3Storage({ send } as any)).toThrow(
      "S3_BUCKET is required when FILE_STORAGE=s3",
    );
  });

  describe("ping", () => {
    it("probes the presign endpoint too when it differs", async () => {
      process.env.S3_PRESIGN_ENDPOINT = "https://edge.example.com";
      const presignSend = jest.fn();
      const dual = new S3Storage({ send } as any, { send: presignSend } as any);
      send.mockResolvedValue({});
      presignSend.mockResolvedValue({});

      await dual.ping();

      expect(send).toHaveBeenCalledTimes(1);
      expect(presignSend).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0].constructor.name).toBe("HeadBucketCommand");
      expect(presignSend.mock.calls[0][0].constructor.name).toBe(
        "HeadBucketCommand",
      );
    });

    it("probes only the main endpoint without S3_PRESIGN_ENDPOINT", async () => {
      delete process.env.S3_PRESIGN_ENDPOINT;
      send.mockResolvedValue({});

      await storage.ping();

      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  it("put sends PutObjectCommand with bucket, key and content type", async () => {
    await storage.put("a/b.txt", Buffer.from("hello"), "text/plain");

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command.constructor.name).toBe("PutObjectCommand");
    expect(command.input).toEqual({
      Bucket: "test-bucket",
      Key: "a/b.txt",
      Body: Buffer.from("hello"),
      ContentType: "text/plain",
    });
  });

  it("put omits ContentType when not provided", async () => {
    await storage.put("a.txt", Buffer.from("x"));

    expect(send.mock.calls[0][0].input.ContentType).toBeUndefined();
  });

  it("exists returns true when HeadObject succeeds", async () => {
    send.mockResolvedValue({});

    expect(await storage.exists("a.txt")).toBe(true);
  });

  it("exists returns false on all 404 shapes", async () => {
    send.mockRejectedValueOnce(notFound({ name: "NotFound" }));
    send.mockRejectedValueOnce(notFound({ name: "NoSuchKey" }));
    send.mockRejectedValueOnce(
      notFound({ $metadata: { httpStatusCode: 404 } }),
    );

    expect(await storage.exists("a.txt")).toBe(false);
    expect(await storage.exists("a.txt")).toBe(false);
    expect(await storage.exists("a.txt")).toBe(false);
  });

  it("exists rethrows non-404 errors", async () => {
    send.mockRejectedValue(new Error("network down"));

    await expect(storage.exists("a.txt")).rejects.toThrow("network down");
  });

  it("get maps the S3 object to a StoredObject", async () => {
    send.mockResolvedValue({
      Body: Readable.from(["hello"]),
      ContentLength: 5,
      ContentType: "text/plain",
    });

    const stored = await storage.get("a.txt");

    expect(stored.contentLength).toBe(5);
    expect(stored.contentType).toBe("text/plain");
    expect(await text(stored.stream as any)).toBe("hello");
  });

  it("get throws StorageNotFoundError on 404 shapes", async () => {
    send.mockRejectedValue(notFound({ name: "NoSuchKey" }));

    await expect(storage.get("missing.txt")).rejects.toThrow(
      StorageNotFoundError,
    );
  });

  it("get rethrows non-404 errors", async () => {
    send.mockRejectedValue(new Error("network down"));

    await expect(storage.get("a.txt")).rejects.toThrow("network down");
  });

  it("delete sends DeleteObjectCommand", async () => {
    send.mockResolvedValue({});

    await storage.delete("a.txt");

    expect(send.mock.calls[0][0].constructor.name).toBe("DeleteObjectCommand");
    expect(send.mock.calls[0][0].input).toEqual({
      Bucket: "test-bucket",
      Key: "a.txt",
    });
  });
});
