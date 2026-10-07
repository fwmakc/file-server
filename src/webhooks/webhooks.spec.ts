import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthClientService } from "api-server-toolkit/auth-client";
import { AclModule } from "../files/acl/acl.module";
import { AclService } from "../files/acl/acl.service";
import { FileAclEntity, FileAclGrantEntity } from "../files/acl/acl.entity";
import { ProcessedEventEntity } from "./processed-event.entity";
import { WebhooksService } from "./webhooks.service";

/**
 * user.deleted delivery: grants of the deleted account are purged inside
 * the same transaction as the dedupe ledger — a redelivery after a crash
 * must be a clean no-op, and unknown patterns must not throw.
 */
describe("webhooks → ACL grant purge (db)", () => {
  let service: WebhooksService;
  let acl: AclService;
  let authMock: { clearCache: jest.Mock };
  let purgeSpy: jest.SpyInstance;

  const envelope = (eventId: number, pattern: string, payload: object) => ({
    eventId,
    pattern,
    payload,
    source: "auth-server",
    timestamp: new Date().toISOString(),
    attempt: 1,
  }) as any;

  const owner = { id: 42, username: "o@t", roles: ["authenticated"] } as any;
  const stranger = { id: 43, username: "x@t", roles: ["authenticated"] } as any;

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
          entities: [FileAclEntity, FileAclGrantEntity, ProcessedEventEntity],
          synchronize: true,
          dropSchema: true,
        }),
        AclModule,
      ],
      providers: [WebhooksService],
    })
      .overrideProvider(AuthClientService)
      .useValue({
        clearCache: jest.fn(),
        getAccountInfo: async (id: number) =>
          id === 42 || id === 43
            ? { id, username: `u${id}@t`, isActivated: true, roles: [] }
            : null,
      })
      .compile();
    service = moduleRef.get(WebhooksService);
    acl = moduleRef.get(AclService);
    authMock = moduleRef.get(AuthClientService) as any;
    purgeSpy = jest.spyOn(acl.constructor.prototype, "purgeAccount");
  });

  it("shares a file with account 43, then the deletion event revokes it", async () => {
    await acl.setAcl(
      {
        path: "42/shared",
        pathType: "folder",
        grants: [{ accountId: 43, mode: "read" }],
      },
      owner,
    );
    expect(await acl.canRead("42/shared/x.txt", stranger)).toBe(true);

    await service.handleEvent(
      envelope(1, "user.deleted", { userId: 43, username: "x@t", email: "x@t" }),
    );

    expect(await acl.canRead("42/shared/x.txt", stranger)).toBe(false);
    // invalidation is per-delivery, outside the ledger
    expect(authMock.clearCache).toHaveBeenCalledWith(43);
  });

  it("a redelivery with the same eventId is a ledger no-op — but still invalidates the cache", async () => {
    purgeSpy.mockClear();
    authMock.clearCache.mockClear();
    await service.handleEvent(
      envelope(1, "user.deleted", { userId: 43, username: "x@t", email: "x@t" }),
    );
    expect(purgeSpy).not.toHaveBeenCalled();
    expect(authMock.clearCache).toHaveBeenCalledWith(43);
  });

  it("roles_changed / deactivated only invalidate the cache", async () => {
    authMock.clearCache.mockClear();
    await service.handleEvent(
      envelope(10, "user.roles_changed", {
        userId: 43,
        username: "x@t",
        email: "x@t",
        roles: [],
      }),
    );
    await service.handleEvent(
      envelope(11, "user.deactivated", {
        userId: 43,
        username: "x@t",
        email: "x@t",
      }),
    );
    expect(authMock.clearCache).toHaveBeenCalledTimes(2);
    expect(authMock.clearCache).toHaveBeenNthCalledWith(1, 43);
    expect(authMock.clearCache).toHaveBeenNthCalledWith(2, 43);
  });

  it("a different eventId still purges (idempotent by construction)", async () => {
    await acl.setAcl(
      {
        path: "42/again",
        pathType: "folder",
        grants: [{ accountId: 43, mode: "write" }],
      },
      owner,
    );
    await service.handleEvent(
      envelope(2, "user.deleted", { userId: 43, username: "x@t", email: "x@t" }),
    );
    expect(await acl.canWrite("42/again/x.txt", stranger)).toBe(false);
  });

  it("unknown patterns are warned about, not thrown", async () => {
    await expect(
      service.handleEvent(envelope(3, "user.registered", {})),
    ).resolves.toBeUndefined();
  });
});
