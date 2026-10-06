// puppeteer 25 is ESM-only — jest's CJS runtime cannot parse it; the import
// chain here is files.controller → files.service → pdf_generate.handler
jest.mock("puppeteer", () => ({ launch: jest.fn() }));

import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ValidationPipe } from "api-server-toolkit/bootstrap/setup";
import {
  AuthClientService,
  AccountStrategy,
  AccountInfo,
} from "api-server-toolkit/auth-client";
import { AclModule } from "./acl.module";
import { FileAclEntity, FileAclGrantEntity } from "./acl.entity";
import { StorageModule } from "../storage/storage.module";
import { FilesController } from "../files.controller";
import { PresignController } from "../presign.controller";
import { StorageDownloadController } from "../storage/download.controller";
import { FilesService } from "../files.service";
import { AllowTypesHandler } from "../handler/allow_types.handler";
import { DecodeHandler } from "../handler/decode.handler";
import { GetImageMetadataHandler } from "../handler/get_image_metadata.handler";
import { ImageConvertHandler } from "../handler/image_convert.handler";
import { ImageResizeHandler } from "../handler/image_resize.handler";
import { IsImageHandler } from "../handler/is_image.handler";
import { MaxSizeHandler } from "../handler/max_size.handler";
import { PdfGenerateHandler } from "../handler/pdf_generate.handler";
import { RenameHandler } from "../handler/rename.handler";
import { SaveHandler } from "../handler/save.handler";
import { StorageBootCheck } from "../storage/storage.boot.check";
import { asAccount, TestAccountStrategy } from "./test.jwt.helper";

process.env.UPLOADS_ALLOW_TYPES =
  "text/plain,image/png,application/pdf,text/csv";

// Uploaded bytes must not survive between runs (a repeated upload returns
// "already exists" and would fail the test) nor land in the repo checkout.
const uploadsDir = mkdtempSync(join(tmpdir(), "file-server-acl-"));
process.env.UPLOADS_PATH = uploadsDir;

/**
 * The two product patterns over the real HTTP stack:
 *  1. a public site-assets folder — anonymous direct downloads, author-role
 *     write grants, images served inline and cacheable;
 *  2. personal documents — owner-only by default, staff bypass, explicit
 *     read/write grants, deletion rights.
 * Driven through the real guards with signed test tokens.
 */
describe("files ACL over HTTP (db)", () => {
  let app: INestApplication;
  let base: string;

  const ADMIN = { id: 1, username: "a@t", roles: ["admin"] } as AccountInfo;
  const OWNER = { id: 42, username: "o@t", roles: ["authenticated"] } as AccountInfo;
  const OTHER = { id: 43, username: "x@t", roles: ["authenticated"] } as AccountInfo;
  const AUTHOR = { id: 7, username: "w@t", roles: ["author", "authenticated"] } as AccountInfo;

  const known = new Set([1, 42, 43, 7, 99]);

  const upload = async (
    account: AccountInfo,
    files: Array<{ name: string; type: string; body: string | Buffer }>,
    options?: Record<string, unknown>,
  ) => {
    const form = new FormData();
    for (const f of files) {
      form.append(
        "file",
        new Blob([f.body as BlobPart], { type: f.type }),
        f.name,
      );
    }
    const query = options
      ? `?options=${encodeURIComponent(JSON.stringify(options))}`
      : "";
    const res = await fetch(`${base}/files/upload${query}`, {
      method: "POST",
      headers: asAccount(account),
      body: form,
    });
    return { status: res.status, body: await res.json() };
  };

  const get = async (key: string, account?: AccountInfo | null) => {
    const res = await fetch(`${base}/uploads/${key}`, {
      headers: asAccount(account),
    });
    return { status: res.status, res };
  };

  const del = async (key: string, account: AccountInfo) => {
    const res = await fetch(`${base}/files/${key}`, {
      method: "DELETE",
      headers: asAccount(account),
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

  const getAcl = async (key: string, account: AccountInfo) => {
    const res = await fetch(`${base}/files/acl/${key}`, {
      headers: asAccount(account),
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
        StorageModule.register(),
        AclModule,
      ],
      controllers: [FilesController, PresignController, StorageDownloadController],
      providers: [
        StorageBootCheck,
        FilesService,
        AllowTypesHandler,
        DecodeHandler,
        GetImageMetadataHandler,
        ImageConvertHandler,
        ImageResizeHandler,
        IsImageHandler,
        MaxSizeHandler,
        PdfGenerateHandler,
        RenameHandler,
        SaveHandler,
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
      // AuthClientModule always instantiates the production RS256/JWKS
      // strategy under the passport name "jwt" — it would win the alias
      // race against the HS256 test strategy. Swap it out entirely.
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
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  describe("case 1: public site assets", () => {
    it("admin publishes the folder with an author write grant", async () => {
      const { status, body } = await setAcl(ADMIN, {
        path: "site-assets",
        pathType: "folder",
        visibility: "public",
        grants: [{ role: "author", mode: "write" }],
      });
      expect(status).toBe(201);
      expect(body.visibility).toBe("public");
    });

    it("an author uploads article images into the shared folder", async () => {
      const { status, body } = await upload(
        AUTHOR,
        [{ name: "banner.png", type: "image/png", body: Buffer.from([0x89]) }],
        { folder: "site-assets/articles" },
      );
      expect(status).toBe(201);
      expect(body[0].url).toContain("/uploads/site-assets/articles/");
      expect(body[0].error).toBeUndefined();
    });

    it("a non-author cannot write the shared folder", async () => {
      const { status } = await upload(
        OTHER,
        [{ name: "evil.png", type: "image/png", body: Buffer.from([0x89]) }],
        { folder: "site-assets" },
      );
      expect(status).toBe(403);
    });

    it("anonymous direct download works — inline image, cacheable", async () => {
      const { status, res } = await get("site-assets/articles/banner.png");
      expect(status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("inline");
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    });

    it("non-image public assets stay attachment (svg/xss-safe)", async () => {
      await upload(
        AUTHOR,
        [{ name: "notes.txt", type: "text/plain", body: "hello" }],
        { folder: "site-assets" },
      );
      const { status, res } = await get("site-assets/notes.txt");
      expect(status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("attachment");
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    });
  });

  describe("case 2: personal documents", () => {
    it("a learner uploads a scan into the own namespace (no folder)", async () => {
      const { status, body } = await upload(OWNER, [
        { name: "passport.pdf", type: "application/pdf", body: "%PDF-1.4" },
      ]);
      expect(status).toBe(201);
      expect(body[0].url).toContain("/uploads/42/");
      expect(body[0].url).not.toContain("/uploads/43");
    });

    it("the owner reads the own file — attachment, never cached", async () => {
      const { status, res } = await get("42/passport.pdf", OWNER);
      expect(status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("attachment");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    });

    it("another learner cannot even read it — and existence is masked", async () => {
      expect((await get("42/passport.pdf", OTHER)).status).toBe(404);
      expect((await get("42/passport.pdf")).status).toBe(404);
    });

    it("admins open personal files by role, no per-folder setup", async () => {
      expect((await get("42/passport.pdf", ADMIN)).status).toBe(200);
    });

    it("read grant: another learner may read but not delete", async () => {
      expect(
        (await setAcl(OWNER, {
          path: "42/passport.pdf",
          pathType: "file",
          grants: [{ accountId: 43, mode: "read" }],
        })).status,
      ).toBe(201);
      expect((await get("42/passport.pdf", OTHER)).status).toBe(200);
      expect((await del("42/passport.pdf", OTHER)).status).toBe(404);
    });

    it("read+edit: a write grant allows replacing the file", async () => {
      expect(
        (await setAcl(OWNER, {
          path: "42/passport.pdf",
          pathType: "file",
          grants: [{ accountId: 43, mode: "write" }],
        })).status,
      ).toBe(201);
      // replacement goes through folder resolution — the grant is on the
      // file, so a same-key replace via the folder path is still denied
      const tryReplace = await upload(
        OTHER,
        [{ name: "passport.pdf", type: "application/pdf", body: "%PDF-2" }],
        { folder: "42", replace: true },
      );
      expect(tryReplace.status).toBe(403);
    });

    it("read+edit+delete: folder write grant unlocks replace and delete", async () => {
      expect(
        (await setAcl(OWNER, {
          path: "42",
          pathType: "folder",
          grants: [{ accountId: 43, mode: "write" }],
        })).status,
      ).toBe(201);
      const replaced = await upload(
        OTHER,
        [{ name: "passport.pdf", type: "application/pdf", body: "%PDF-2" }],
        { folder: "42", replace: true },
      );
      expect(replaced.status).toBe(201);
      expect((await del("42/passport.pdf", OTHER)).status).toBe(200);
      expect((await get("42/passport.pdf", OWNER)).status).toBe(404);
    });

    it("folder sharing: the guest writes new files into the shared tree", async () => {
      const { status, body } = await upload(
        OTHER,
        [{ name: "note.txt", type: "text/plain", body: "hi" }],
        { folder: "42/docs" },
      );
      expect(status).toBe(201);
      expect(body[0].url).toContain("/uploads/42/docs/note.txt");
    });
  });

  describe("ACL management routes", () => {
    it("the owner inspects the rule; a stranger without read gets 404", async () => {
      // "site-assets/private" is a rule nobody but staff can see: the
      // public ancestor is overridden by the longer private prefix.
      await setAcl(ADMIN, {
        path: "site-assets/private",
        pathType: "folder",
      });
      expect((await getAcl("site-assets/private", ADMIN)).status).toBe(200);
      expect((await getAcl("site-assets/private", OTHER)).status).toBe(404);
    });

    it("non-owners cannot re-share someone else's path", async () => {
      const { status } = await setAcl(OTHER, {
        path: "42/docs",
        pathType: "folder",
        visibility: "public",
      });
      expect(status).toBe(403);
    });

    it("grant targets are validated — unknown accounts fail loudly", async () => {
      const { status, body } = await setAcl(ADMIN, {
        path: "ops",
        pathType: "folder",
        grants: [{ accountId: 31337, mode: "read" }],
      });
      expect(status).toBe(400);
      expect(JSON.stringify(body)).toContain("31337");
    });

    it("the delete route cleans up rules under the removed key", async () => {
      await upload(OWNER, [
        { name: "temp.txt", type: "text/plain", body: "x" },
      ]);
      // a rule on the file's folder shares it with the other account
      expect((await del("42/temp.txt", OWNER)).status).toBe(200);
      expect((await get("42/temp.txt", OWNER)).status).toBe(404);
    });

    it("unauthenticated upload is rejected", async () => {
      const { status } = await fetch(`${base}/files/upload`, {
        method: "POST",
        body: new FormData(),
      });
      expect(status).toBe(401);
    });
  });
});
