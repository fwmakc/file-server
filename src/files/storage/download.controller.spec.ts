import { NotFoundException, StreamableFile } from "@nestjs/common";
import { Readable } from "stream";
import { StorageDownloadController } from "./download.controller";
import { StorageNotFoundError } from "./storage.interface";

describe("StorageDownloadController", () => {
  let storage: { get: jest.Mock };
  let acl: { isPublic: jest.Mock; canRead: jest.Mock };
  let controller: StorageDownloadController;
  // owner of everything under 42/ — passes through the ACL check
  const owner = { id: 42, username: "o@t", roles: ["authenticated"] };
  const res = () => ({ setHeader: jest.fn(), on: jest.fn() }) as any;

  beforeEach(() => {
    storage = { get: jest.fn() };
    acl = { isPublic: jest.fn().mockResolvedValue(false), canRead: jest.fn().mockResolvedValue(true) };
    controller = new StorageDownloadController(storage as any, acl as any);
  });

  it("404 for empty keys without touching storage or ACL", async () => {
    await expect(controller.download("", owner, res())).rejects.toThrow(
      NotFoundException,
    );
    await expect(controller.download("..", owner, res())).rejects.toThrow(
      NotFoundException,
    );
    await expect(controller.download("../../..", owner, res())).rejects.toThrow(
      NotFoundException,
    );
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("404 when the ACL denies the read — storage never sees the key", async () => {
    acl.canRead.mockResolvedValue(false);

    await expect(controller.download("43/secret.bin", owner, res())).rejects.toThrow(
      NotFoundException,
    );
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("a public prefix short-circuits the account check", async () => {
    acl.isPublic.mockResolvedValue(true);
    acl.canRead.mockClear();
    storage.get.mockResolvedValue({ stream: Readable.from(["x"]) });
    const mockRes = res();

    await controller.download("site-assets/logo.png", null as any, mockRes);

    expect(acl.canRead).not.toHaveBeenCalled();
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, max-age=300",
    );
  });

  it("sanitizes traversal and streams with metadata headers", async () => {
    storage.get.mockResolvedValue({
      stream: Readable.from(["hello"]),
      contentLength: 5,
      contentType: "text/plain",
    });
    const mockRes = res();

    const result = await controller.download("../../etc/passwd", owner, mockRes);

    expect(storage.get).toHaveBeenCalledWith("etc/passwd");
    expect(result).toBeInstanceOf(StreamableFile);
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/plain",
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Length", "5");
    // private bytes are never cacheable
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store",
    );
  });

  it("sends Content-Disposition attachment with an ASCII-safe filename", async () => {
    storage.get.mockResolvedValue({
      stream: Readable.from(["<h1>x</h1>"]),
      contentType: "text/html",
    });
    const mockRes = res();

    await controller.download("uploads/отчёт.html", owner, mockRes);

    const disposition = mockRes.setHeader.mock.calls.find(
      ([h]) => h === "Content-Disposition",
    )[1];
    expect(disposition).toMatch(/^attachment; filename="/);
    expect(disposition).toContain(".html");
    // не-ASCII и кавычки вычищены — header инъекция невозможна
    expect(disposition).not.toMatch(/[^\x20-\x7e"]/);
  });

  it("public raster images render inline (site assets)", async () => {
    acl.isPublic.mockResolvedValue(true);
    storage.get.mockResolvedValue({ stream: Readable.from(["x"]) });
    const mockRes = res();

    await controller.download("site-assets/pic.png", null as any, mockRes);

    const disposition = mockRes.setHeader.mock.calls.find(
      ([h]) => h === "Content-Disposition",
    )[1];
    expect(disposition).toContain("inline");
    // content type falls back to the key extension (local storage keeps none)
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "image/png",
    );
  });

  it("derives Content-Type from the key extension when storage has none", async () => {
    storage.get.mockResolvedValue({ stream: Readable.from(["x"]) });
    const mockRes = res();

    await controller.download("a.txt", owner, mockRes);

    const headers = mockRes.setHeader.mock.calls.map(([h]) => h);
    expect(headers).toEqual([
      "Content-Type",
      "Content-Disposition",
      "Cache-Control",
    ]);
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/plain",
    );
  });

  it("404 when storage reports not found", async () => {
    storage.get.mockRejectedValue(new StorageNotFoundError("missing.txt"));

    await expect(controller.download("missing.txt", owner, res())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('bubbles storage failures that are not "not found"', async () => {
    storage.get.mockRejectedValue(new Error("network down"));

    await expect(controller.download("a.txt", owner, res())).rejects.toThrow(
      "network down",
    );
  });

  it("destroys the storage stream when the response closes (client abort)", async () => {
    const stream = Readable.from(["hello"]) as any;
    const destroy = jest.spyOn(stream, "destroy");
    storage.get.mockResolvedValue({ stream });
    const mockRes = res();

    await controller.download("a.txt", owner, mockRes);

    // controller registered the close hook; firing it (Express does this on
    // both abort and normal end) must tear the s3 socket down
    const closeCb = mockRes.on.mock.calls.find(([ev]) => ev === "close")[1];
    closeCb();
    expect(destroy).toHaveBeenCalled();
  });
});
