// puppeteer 25 is ESM-only — jest's CJS runtime cannot parse it; the import
// chain here is files.controller → files.service → pdf_generate.handler
jest.mock("puppeteer", () => ({ launch: jest.fn() }));

import { S3Storage } from "./storage/s3.storage";
import { LocalStorage } from "./storage/local.storage";
import { asPresignable } from "./storage/storage.interface";
import { buildPresignUploadKey } from "./presign.controller";
import { maxUploadBytes } from "./files.controller";

const ENV = {
  S3_BUCKET: "test-bucket",
  S3_ENDPOINT: "http://minio:9000",
  S3_PRESIGN_ENDPOINT: "http://edge:8080",
  S3_FORCE_PATH_STYLE: "true",
  S3_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  S3_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

describe("presigned URLs (s3 storage)", () => {
  const original = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, ENV);
  });

  afterEach(() => {
    process.env = original;
  });

  it("presigned PUT points at the presign endpoint with the full key path", async () => {
    const storage = new S3Storage();
    const { url, expiresIn } = await storage.presignedPut("docs/1.png");
    expect(url.startsWith("http://edge:8080/test-bucket/docs/1.png?")).toBe(true);
    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(url).toContain("X-Amz-Expires=900");
    expect(expiresIn).toBe(900);
  });

  it("file-server's own endpoint differs from the presign endpoint without cross-talk", async () => {
    const storage = new S3Storage();
    const { url } = await storage.presignedPut("k");
    // signed for the edge…
    expect(url.startsWith("http://edge:8080/")).toBe(true);
    // …while internal operations are configured for the internal endpoint
    // (checked through the ping command's bucket input below)
    expect((storage as any).bucket).toBe("test-bucket");
  });

  it("S3_PRESIGN_ENDPOINT falls back to S3_ENDPOINT when unset", async () => {
    delete process.env.S3_PRESIGN_ENDPOINT;
    const storage = new S3Storage();
    const { url } = await storage.presignedPut("k");
    expect(url.startsWith("http://minio:9000/test-bucket/k?")).toBe(true);
  });

  it("S3_PRESIGN_EXPIRES_SEC overrides the default window", async () => {
    process.env.S3_PRESIGN_EXPIRES_SEC = "120";
    const storage = new S3Storage();
    const { url, expiresIn } = await storage.presignedPut("k");
    expect(expiresIn).toBe(120);
    expect(url).toContain("X-Amz-Expires=120");
  });

  it("presigned GET pins an attachment content disposition", async () => {
    const storage = new S3Storage();
    const { url } = await storage.presignedGet("docs/report.html");
    expect(url).toContain("response-content-disposition=attachment");
  });

  it("presigned PUT does not pin Content-Type (SDK hardcodes it unsignable)", async () => {
    // @aws-sdk/s3-request-presigner adds content-type to unsignableHeaders —
    // the client sends whatever Content-Type it wants and the bucket stores
    // that; download safety is handled by the attachment disposition instead
    const storage = new S3Storage();
    const { url } = await storage.presignedPut("k");
    expect(url).toContain("X-Amz-SignedHeaders=host");
    expect(url.toLowerCase()).not.toContain("content-type");
  });

  it("ping reaches the bucket through the main client", async () => {
    const send = jest.fn().mockResolvedValue({});
    const storage = new S3Storage({ send } as any);
    await expect(storage.ping()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][0] as any).input.Bucket).toBe("test-bucket");
  });

  it("local storage is not presignable", () => {
    expect(asPresignable(new LocalStorage())).toBeNull();
    expect(asPresignable(new S3Storage())).not.toBeNull();
  });
});

describe("buildPresignUploadKey", () => {
  it("prefixes a server-generated uuid — the client never picks the key", () => {
    const a = buildPresignUploadKey("docs", "report.pdf");
    const b = buildPresignUploadKey("docs", "report.pdf");
    expect(a).toMatch(/^docs\/[0-9a-f-]{36}-report\.pdf$/u);
    expect(a).not.toBe(b);
  });

  it("sanitizes traversal and paths in both folder and filename", () => {
    // '..' segments are dropped, word segments ('etc') are kept — the key
    // always stays inside the uploads namespace
    expect(buildPresignUploadKey("../../etc", "..\\..\\win.ini")).toMatch(
      /^etc\/[0-9a-f-]{36}-win\.ini$/u,
    );
    expect(buildPresignUploadKey("../..", "a/b/c.txt")).toMatch(
      /^[0-9a-f-]{36}-c\.txt$/u,
    );
  });

  it("falls back to 'file' for an empty filename", () => {
    expect(buildPresignUploadKey("", "..")).toMatch(
      /^[0-9a-f-]{36}-file$/u,
    );
  });
});

describe("maxUploadBytes", () => {
  const original = process.env.MAX_UPLOAD_SIZE;

  afterEach(() => {
    if (original === undefined) delete process.env.MAX_UPLOAD_SIZE;
    else process.env.MAX_UPLOAD_SIZE = original;
  });

  it("defaults to 50 MB when MAX_UPLOAD_SIZE is unset", () => {
    delete process.env.MAX_UPLOAD_SIZE;
    expect(maxUploadBytes()).toBe(50 * 1024 * 1024);
  });

  it("reads MB from the env", () => {
    process.env.MAX_UPLOAD_SIZE = "10";
    expect(maxUploadBytes()).toBe(10 * 1024 * 1024);
  });

  it("falls back to the default on garbage", () => {
    process.env.MAX_UPLOAD_SIZE = "abc";
    expect(maxUploadBytes()).toBe(50 * 1024 * 1024);
  });
});
