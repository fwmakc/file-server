import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { Readable } from "stream";
import { StorageDownloadController } from "./download.controller";
import {
  FILES_STORAGE,
  StorageNotFoundError,
} from "./storage.interface";

process.env.UPLOADS_URL = "/uploads";

/**
 * Реальный HTTP-стек (Express 5): проверяет регистрацию wildcard-роута
 * `*splat` и проброс параметров, чего unit-тест контроллера не покрывает.
 */
describe("StorageDownloadController route (e2e)", () => {
  let app: INestApplication;
  let storage: { get: jest.Mock };
  let port: number;

  beforeAll(async () => {
    storage = { get: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [StorageDownloadController],
      providers: [{ provide: FILES_STORAGE, useValue: storage }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
  });

  it("streams an object with metadata headers", async () => {
    storage.get.mockResolvedValue({
      stream: Readable.from(["hello"]),
      contentLength: 5,
      contentType: "text/plain",
    });

    const res = await fetch(`http://127.0.0.1:${port}/uploads/photos/pic.png`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("content-length")).toBe("5");
    expect(await res.text()).toBe("hello");
    expect(storage.get).toHaveBeenCalledWith("photos/pic.png");
  });

  it("404 for missing objects", async () => {
    storage.get.mockRejectedValue(new StorageNotFoundError("missing.txt"));

    const res = await fetch(`http://127.0.0.1:${port}/uploads/missing.txt`);

    expect(res.status).toBe(404);
  });

  it("404 for empty and traversal-only paths", async () => {
    storage.get.mockClear();

    expect((await fetch(`http://127.0.0.1:${port}/uploads`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/uploads/..`)).status).toBe(
      404,
    );
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("500 for storage failures that are not not-found", async () => {
    storage.get.mockRejectedValue(new Error("network down"));

    const res = await fetch(`http://127.0.0.1:${port}/uploads/a.txt`);

    expect(res.status).toBe(500);
  });
});
