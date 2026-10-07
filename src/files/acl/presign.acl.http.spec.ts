// puppeteer 25 is ESM-only — jest's CJS runtime cannot parse it; the import
// chain here is presign.controller → save.handler (sanitizeFilename)
jest.mock("puppeteer", () => ({ launch: jest.fn() }));

import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Readable } from "stream";
import { ValidationPipe } from "api-server-toolkit/bootstrap/setup";
import {
  AuthClientService,
  AccountStrategy,
  AccountInfo,
} from "api-server-toolkit/auth-client";
import { AclModule } from "./acl.module";
import { FileAclEntity, FileAclGrantEntity } from "./acl.entity";
import { PresignController } from "../presign.controller";
import {
  FILES_STORAGE,
  IFileStorage,
  IPresignableStorage,
  PresignedUrl,
  StorageNotFoundError,
  StoredObject,
} from "../storage/storage.interface";
import { asAccount, TestAccountStrategy } from "./test.jwt.helper";

/**
 * Presign routes under the ACL: the same decision matrix as the byte
 * endpoints, over an in-memory presignable storage stub (the routes need
 * the capability interface, not a real bucket). PUT keys are server-built
 * inside an ACL-resolved folder; GET links are only issued to readers.
 */
describe("presign routes under ACL (db)", () => {
  let app: INestApplication;
  let base: string;
  let storage: PresignableStubStorage;

  const ADMIN = { id: 1, username: "a@t", roles: ["admin"] } as AccountInfo;
  const OWNER = { id: 42, username: "o@t", roles: ["authenticated"] } as AccountInfo;
  const OTHER = { id: 43, username: "x@t", roles: ["authenticated"] } as AccountInfo;

  const known = new Set([1, 42, 43]);

  class PresignableStubStorage implements IFileStorage, IPresignableStorage {
    private readonly objects = new Map<string, Buffer>();

    async put(key: string, buffer: Buffer): Promise<void> {
      this.objects.set(key, buffer);
    }
    async exists(key: string): Promise<boolean> {
      return this.objects.has(key);
    }
    async get(key: string): Promise<StoredObject> {
      const buf = this.objects.get(key);
      if (buf === undefined) throw new StorageNotFoundError(key);
      return { stream: Readable.from(buf) };
    }
    async delete(key: string): Promise<void> {
      this.objects.delete(key);
    }
    async ping(): Promise<void> {}
    async presignedPut(key: string): Promise<PresignedUrl> {
      return { url: `https://bucket.example.com/put/${key}`, expiresIn: 600 };
    }
    async presignedGet(key: string): Promise<PresignedUrl> {
      return { url: `https://bucket.example.com/get/${key}`, expiresIn: 300 };
    }
  }

  const presignUpload = async (account: AccountInfo, body: object) => {
    const res = await fetch(`${base}/files/presign/upload`, {
      method: "POST",
      headers: { "content-type": "application/json", ...asAccount(account) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const presignDownload = async (account: AccountInfo, key: string) => {
    const res = await fetch(`${base}/files/presign/download`, {
      method: "POST",
      headers: { "content-type": "application/json", ...asAccount(account) },
      body: JSON.stringify({ key }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const setAcl = async (account: AccountInfo, payload: object) => {
    const res = await fetch(`${base}/files/acl`, {
      method: "POST",
      headers: { "content-type": "application/json", ...asAccount(account) },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          host: process.env.DB_HOST || "localhost",
          port: Number(process.env.DB_PORT || 5432),
          username: process.env.DB_USER || "root",
          password: process.env.DB_PASSWORD || "",
          database: process.env.DB_NAME || "file_server_test",
          entities: [FileAclEntity, FileAclGrantEntity],
          synchronize: true,
          dropSchema: true,
        }),
        AclModule,
      ],
      controllers: [PresignController],
      providers: [
        { provide: FILES_STORAGE, useFactory: () => (storage ??= new PresignableStubStorage()) },
        TestAccountStrategy,
      ],
    })
      .overrideProvider(AuthClientService)
      .useValue({
        getAccountInfo: async (id: number) =>
          known.has(id)
            ? { id, username: `u${id}@t`, isActivated: true, roles: [] }
            : null,
      })
      .overrideProvider(AccountStrategy)
      .useClass(TestAccountStrategy)
      .compile();

    app = moduleRef.createNestApplication();
    ValidationPipe.setup(app);
    await app.listen(0);
    base = `http://127.0.0.1:${
      (app.getHttpServer().address() as { port: number }).port
    }`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("unauthenticated presign is rejected on both routes", async () => {
    expect(
      (await fetch(`${base}/files/presign/upload`, { method: "POST" })).status,
    ).toBe(401);
    expect(
      (await fetch(`${base}/files/presign/download`, { method: "POST" })).status,
    ).toBe(401);
  });

  it("upload presign lands in the own namespace — the client never picks the root", async () => {
    const { status, body } = await presignUpload(OWNER, {
      filename: "report.pdf",
    });
    expect(status).toBe(201);
    expect(body.key).toMatch(/^42\/[0-9a-f-]+-report\.pdf$/u);
    expect(body.url).toBe(`https://bucket.example.com/put/${body.key}`);
    expect(body.expiresIn).toBe(600);
  });

  it("upload presign into a shared folder without a grant → 403", async () => {
    const { status } = await presignUpload(OWNER, {
      filename: "x.png",
      folder: "site-assets",
    });
    expect(status).toBe(403);
  });

  it("upload presign into a write-granted shared folder builds the key under it", async () => {
    expect(
      (
        await setAcl(ADMIN, {
          path: "site-assets",
          pathType: "folder",
          visibility: "public",
          grants: [{ accountId: 43, mode: "write" }],
        })
      ).status,
    ).toBe(201);
    const { status, body } = await presignUpload(OTHER, {
      filename: "banner.png",
      folder: "site-assets",
    });
    expect(status).toBe(201);
    expect(body.key).toMatch(/^site-assets\/[0-9a-f-]+-banner\.png$/u);
  });

  it("download presign of someone else's private key is 404-masked", async () => {
    await storage.put("42/secret.pdf", Buffer.from("%PDF-1.4"));
    const { status } = await presignDownload(OTHER, "42/secret.pdf");
    expect(status).toBe(404);
  });

  it("download presign of the own key → 201 with a signed url", async () => {
    const { status, body } = await presignDownload(OWNER, "42/secret.pdf");
    expect(status).toBe(201);
    expect(body.url).toBe("https://bucket.example.com/get/42/secret.pdf");
    expect(body.expiresIn).toBe(300);
  });

  it("download presign with a read grant → 201; without → 404", async () => {
    await storage.put("42/shared.bin", Buffer.from("x"));
    expect((await presignDownload(OTHER, "42/shared.bin")).status).toBe(404);
    expect(
      (
        await setAcl(OWNER, {
          path: "42/shared.bin",
          pathType: "file",
          grants: [{ accountId: 43, mode: "read" }],
        })
      ).status,
    ).toBe(201);
    const { status, body } = await presignDownload(OTHER, "42/shared.bin");
    expect(status).toBe(201);
    expect(body.url).toBe("https://bucket.example.com/get/42/shared.bin");
  });

  it("download presign under a public rule → 201 for any authenticated account", async () => {
    await storage.put("site-assets/logo.png", Buffer.from([0x89]));
    const { status, body } = await presignDownload(OTHER, "site-assets/logo.png");
    expect(status).toBe(201);
    expect(body.url).toBe("https://bucket.example.com/get/site-assets/logo.png");
  });

  it("download presign of a missing object stays 404 (no URL for ghosts)", async () => {
    const { status } = await presignDownload(OWNER, "42/ghost.pdf");
    expect(status).toBe(404);
  });
});
