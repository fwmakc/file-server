// puppeteer 25 is ESM-only — jest's CJS runtime cannot parse it; the import
// chain here is files.controller → files.service → pdf_generate.handler
jest.mock("puppeteer", () => ({ launch: jest.fn() }));

import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { Readable } from "stream";
import { StorageDownloadController } from "./download.controller";
import { FILES_STORAGE, StorageNotFoundError } from "./storage.interface";
import { AclService } from "../acl/acl.service";
import { asAccount, TestAccountStrategy } from "../acl/test.jwt.helper";

process.env.UPLOADS_URL = "/uploads";

/**
 * Реальный HTTP-стек (Express 5): проверяет регистрацию wildcard-роута
 * `*splat`, проброс параметров и работу @Account("noBlock") поверх
 * подписанного тестового токена — приватный файл читается только со
 * своим токеном, аноним получает 404.
 */
describe("StorageDownloadController route (e2e)", () => {
  let app: INestApplication;
  let storage: { get: jest.Mock };
  let acl: { isPublic: jest.Mock; canRead: jest.Mock };
  let port: number;

  const owner = { id: 42, username: "o@t", roles: ["authenticated"] };

  beforeAll(async () => {
    storage = { get: jest.fn() };
    acl = {
      isPublic: jest.fn().mockResolvedValue(false),
      canRead: jest.fn().mockResolvedValue(false),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [StorageDownloadController],
      providers: [
        { provide: FILES_STORAGE, useValue: storage },
        { provide: AclService, useValue: acl },
        TestAccountStrategy,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
  });

  it("denies anonymous access to a private object (existence masked)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/uploads/42/private.bin`);
    expect(res.status).toBe(404);
  });

  it("serves the owner with a valid token and stream metadata", async () => {
    acl.canRead.mockResolvedValue(true);
    storage.get.mockResolvedValue({
      stream: Readable.from(["hello"]),
      contentLength: 5,
      contentType: "text/plain",
    });

    const res = await fetch(`http://127.0.0.1:${port}/uploads/photos/pic.png`, {
      headers: asAccount(owner as any),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("content-length")).toBe("5");
    expect(await res.text()).toBe("hello");
    expect(storage.get).toHaveBeenCalledWith("photos/pic.png");
  });

  it("serves a public prefix to anonymous traffic", async () => {
    acl.isPublic.mockResolvedValue(true);
    storage.get.mockResolvedValue({
      stream: Readable.from(["pub"]),
      contentType: "text/plain",
    });

    const res = await fetch(`http://127.0.0.1:${port}/uploads/site-assets/a.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pub");
  });

  it("404 for missing objects", async () => {
    acl.canRead.mockResolvedValue(true);
    storage.get.mockRejectedValue(new StorageNotFoundError("missing.txt"));

    const res = await fetch(`http://127.0.0.1:${port}/uploads/missing.txt`, {
      headers: asAccount(owner as any),
    });

    expect(res.status).toBe(404);
  });

  it("404 for empty and traversal-only paths", async () => {
    storage.get.mockClear();

    expect(
      (await fetch(`http://127.0.0.1:${port}/uploads`)).status,
    ).toBe(404);
    expect(
      (await fetch(`http://127.0.0.1:${port}/uploads/..`)).status,
    ).toBe(404);
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("500 for storage failures that are not not-found", async () => {
    storage.get.mockRejectedValue(new Error("network down"));

    const res = await fetch(`http://127.0.0.1:${port}/uploads/a.txt`, {
      headers: asAccount(owner as any),
    });

    expect(res.status).toBe(500);
  });
});
