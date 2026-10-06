import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ForbiddenException } from "@nestjs/common";
import { AuthClientService } from "api-server-toolkit/auth-client";
import { AccountInfo } from "api-server-toolkit/auth-client";
import { AclService, isOwnPath, canonicalAclPath } from "./acl.service";
import { FileAclEntity, FileAclGrantEntity, grantSubject } from "./acl.entity";
import { AclModule } from "./acl.module";

/**
 * AclService decision matrix against a real Postgres schema (scratch
 * database, synchronize + dropSchema). Account existence/roles are stubbed
 * at the auth-client boundary — the service contract under test is the
 * ACL resolution itself.
 */
describe("AclService (db)", () => {
  let acl: AclService;
  let getAccountInfo: jest.Mock;

  const known = new Set([42, 43, 7]);
  const authStub = (id: number) =>
    known.has(id)
      ? { id, username: `u${id}@test`, isActivated: true, roles: [] }
      : null;

  const owner = { id: 42, username: "u42", roles: ["authenticated"] } as AccountInfo;
  const stranger = { id: 43, username: "u43", roles: ["authenticated"] } as AccountInfo;
  const author = { id: 7, username: "u7", roles: ["author", "authenticated"] } as AccountInfo;
  const admin = { id: 1, username: "u1", roles: ["admin"] } as AccountInfo;
  const editor = { id: 2, username: "u2", roles: ["editor"] } as AccountInfo;
  const anon = { roles: ["public"] } as AccountInfo;

  beforeAll(async () => {
    getAccountInfo = jest.fn(async (id: number) => authStub(id));
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
    })
      .overrideProvider(AuthClientService)
      .useValue({ getAccountInfo })
      .compile();
    acl = moduleRef.get(AclService);
  });

  describe("path helpers", () => {
    it("folders keep the trailing slash, files do not", () => {
      expect(canonicalAclPath("a/b", "folder")).toBe("a/b/");
      expect(canonicalAclPath("a/b/c.png", "file")).toBe("a/b/c.png");
      expect(canonicalAclPath("../../etc", "folder")).toBe("etc/");
      expect(canonicalAclPath("", "folder")).toBe("");
    });

    it("own namespace matches the root and anything under it", () => {
      expect(isOwnPath("42", 42)).toBe(true);
      expect(isOwnPath("42/docs/x.pdf", 42)).toBe(true);
      expect(isOwnPath("421/x", 42)).toBe(false);
      expect(isOwnPath("42/docs/x.pdf", undefined)).toBe(false);
    });
  });

  describe("namespace stamping (write resolution)", () => {
    it("empty folder lands in the account root", async () => {
      await expect(acl.resolveWriteFolder("", owner)).resolves.toBe("42");
    });

    it("own subfolders pass unchanged", async () => {
      await expect(acl.resolveWriteFolder("42/docs", owner)).resolves.toBe(
        "42/docs",
      );
    });

    it("a folder outside the namespace is forbidden without a grant", async () => {
      await expect(
        acl.resolveWriteFolder("site-assets", stranger),
      ).rejects.toThrow(ForbiddenException);
    });

    it("a role write grant opens the shared folder", async () => {
      await acl.setAcl(
        {
          path: "site-assets",
          pathType: "folder",
          visibility: "public",
          grants: [{ role: "author", mode: "write" }],
        },
        admin,
      );
      await expect(
        acl.resolveWriteFolder("site-assets/articles", author),
      ).resolves.toBe("site-assets/articles");
      // the key stays under the shared prefix, never re-rooted
    });

    it("write grant to an account opens the shared folder", async () => {
      await acl.setAcl(
        {
          path: "team",
          pathType: "folder",
          grants: [{ accountId: 43, mode: "write" }],
        },
        admin,
      );
      await expect(acl.resolveWriteFolder("team/x", stranger)).resolves.toBe(
        "team/x",
      );
    });

    it("staff writes anywhere", async () => {
      await expect(acl.resolveWriteFolder("anything", admin)).resolves.toBe(
        "anything",
      );
    });
  });

  describe("read decisions", () => {
    beforeAll(async () => {
      // site-assets/ is public (from the previous block); add a private
      // override deeper in the tree and a personal file with grants.
      await acl.setAcl(
        { path: "site-assets/private", pathType: "folder" },
        admin,
      );
      await acl.setAcl(
        {
          path: "42/scan.pdf",
          pathType: "file",
          grants: [{ accountId: 43, mode: "read" }],
        },
        owner,
      );
    });

    it("public rule: anonymous can read the tree", async () => {
      expect(await acl.isPublic("site-assets/logo.png")).toBe(true);
      expect(await acl.canRead("site-assets/logo.png", anon)).toBe(true);
      expect(await acl.canRead("site-assets/logo.png", null)).toBe(true);
    });

    it("longest prefix wins over the public ancestor", async () => {
      expect(await acl.isPublic("site-assets/private/budget.csv")).toBe(false);
      expect(await acl.canRead("site-assets/private/budget.csv", anon)).toBe(
        false,
      );
      // siblings outside the override stay public
      expect(await acl.isPublic("site-assets/ok.png")).toBe(true);
    });

    it("private by default: no rule, not own — denied even for reading", async () => {
      // a key outside stranger's own namespace (43/… would be his own root)
      expect(await acl.canRead("44/secret.bin", stranger)).toBe(false);
      expect(await acl.canRead("44/secret.bin", anon)).toBe(false);
      expect(await acl.canRead("legacy/old.bin", stranger)).toBe(false);
    });

    it("owner always reads the own namespace", async () => {
      expect(await acl.canRead("42/whatever.bin", owner)).toBe(true);
    });

    it("read grant allows reading but not writing", async () => {
      expect(await acl.canRead("42/scan.pdf", stranger)).toBe(true);
      expect(await acl.canWrite("42/scan.pdf", stranger)).toBe(false);
    });

    it("write grant implies reading and writing", async () => {
      await acl.setAcl(
        {
          path: "42/scan.pdf",
          pathType: "file",
          grants: [{ accountId: 43, mode: "write" }],
        },
        owner,
      );
      expect(await acl.canRead("42/scan.pdf", stranger)).toBe(true);
      expect(await acl.canWrite("42/scan.pdf", stranger)).toBe(true);
    });

    it("staff bypasses every rule (admin, editor, superuser)", async () => {
      expect(await acl.canRead("43/secret.bin", admin)).toBe(true);
      expect(await acl.canWrite("43/secret.bin", editor)).toBe(true);
      expect(
        await acl.canRead("43/secret.bin", {
          id: 9,
          isSuperuser: true,
        } as AccountInfo),
      ).toBe(true);
    });
  });

  describe("setAcl authorization and validation", () => {
    it("non-staff cannot create rules on shared paths", async () => {
      await expect(
        acl.setAcl({ path: "site-assets", pathType: "folder" }, stranger),
      ).rejects.toThrow(ForbiddenException);
    });

    it("owner creates rules on the own namespace", async () => {
      const view = await acl.setAcl(
        { path: "42/docs", pathType: "folder" },
        owner,
      );
      expect(view.visibility).toBe("private");
      expect(view.accountId).toBe("42");
    });

    it("grant targets are validated against auth-server", async () => {
      getAccountInfo.mockClear();
      await expect(
        acl.setAcl(
          {
            path: "42/docs",
            pathType: "folder",
            grants: [{ accountId: 999999, mode: "read" }],
          },
          owner,
        ),
      ).rejects.toThrow(/Unknown accounts/);
      expect(getAccountInfo).toHaveBeenCalledWith(999999);
    });

    it("a grant needs exactly one of accountId | role", async () => {
      await expect(
        acl.setAcl(
          {
            path: "42/docs",
            pathType: "folder",
            grants: [{ accountId: 43, role: "author", mode: "read" }],
          },
          owner,
        ),
      ).rejects.toThrow(/exactly one/);
    });

    it("grants are replaced wholesale on update", async () => {
      await acl.setAcl(
        {
          path: "42/docs",
          pathType: "folder",
          grants: [
            { accountId: 43, mode: "read" },
            { role: "author", mode: "write" },
          ],
        },
        owner,
      );
      const view = await acl.setAcl(
        {
          path: "42/docs",
          pathType: "folder",
          grants: [{ role: "author", mode: "write" }],
        },
        owner,
      );
      expect(view.grants).toEqual([
        { role: "author", mode: "write" },
      ]);
      // replaced: the account grant is gone
      expect(await acl.canRead("42/docs/x.pdf", stranger)).toBe(false);
      expect(await acl.canWrite("42/docs/x.pdf", author)).toBe(true);
    });
  });

  describe("lifecycle cleanup", () => {
    it("purgeAccount drops only that account's grants", async () => {
      await acl.setAcl(
        {
          path: "42/tmp",
          pathType: "folder",
          grants: [
            { accountId: 43, mode: "read" },
            { role: "author", mode: "read" },
          ],
        },
        owner,
      );
      expect(await acl.canRead("42/tmp/x", stranger)).toBe(true);
      await acl.purgeAccount(43);
      expect(await acl.canRead("42/tmp/x", stranger)).toBe(false);
      // role grant survives
      expect(await acl.canRead("42/tmp/x", author)).toBe(true);
      expect(getAccountInfo.mock.results.length).toBeGreaterThan(0);
    });

    it("removeTree drops rules for the key and under it", async () => {
      await acl.setAcl({ path: "42/gone", pathType: "folder" }, owner);
      await acl.setAcl({ path: "42/gone/deep", pathType: "folder" }, owner);
      await acl.setAcl({ path: "42/stays", pathType: "folder" }, owner);
      await acl.removeTree("42/gone");
      expect(await acl.describeMatch("42/gone")).toBeNull();
      expect(await acl.describeMatch("42/gone/deep")).toBeNull();
      expect((await acl.describeMatch("42/stays"))?.path).toBe("42/stays/");
    });
  });
});
