import { NotFoundException, StreamableFile } from "@nestjs/common";
import { Readable } from "stream";
import { StorageDownloadController } from "./download.controller";
import { StorageNotFoundError } from "./storage.interface";

describe("StorageDownloadController", () => {
  let storage: { get: jest.Mock };
  let controller: StorageDownloadController;
  const res = () =>
    ({ setHeader: jest.fn(), on: jest.fn() }) as any;

  beforeEach(() => {
    storage = { get: jest.fn() };
    controller = new StorageDownloadController(storage as any);
  });

  it("404 for empty keys without touching storage", async () => {
    await expect(controller.download("", res())).rejects.toThrow(
      NotFoundException,
    );
    await expect(controller.download("..", res())).rejects.toThrow(
      NotFoundException,
    );
    await expect(controller.download("../../..", res())).rejects.toThrow(
      NotFoundException,
    );
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("sanitizes traversal and streams with metadata headers", async () => {
    storage.get.mockResolvedValue({
      stream: Readable.from(["hello"]),
      contentLength: 5,
      contentType: "text/plain",
    });
    const mockRes = res();

    const result = await controller.download("../../etc/passwd", mockRes);

    expect(storage.get).toHaveBeenCalledWith("etc/passwd");
    expect(result).toBeInstanceOf(StreamableFile);
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/plain",
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Length", "5");
  });

  it("sends Content-Disposition attachment with an ASCII-safe filename", async () => {
    storage.get.mockResolvedValue({
      stream: Readable.from(["<h1>x</h1>"]),
      contentType: "text/html",
    });
    const mockRes = res();

    await controller.download("uploads/отчёт.html", mockRes);

    const disposition = mockRes.setHeader.mock.calls.find(
      ([h]) => h === "Content-Disposition",
    )[1];
    expect(disposition).toMatch(/^attachment; filename="/);
    expect(disposition).toContain(".html");
    // не-ASCII и кавычки вычищены — header инъекция невозможна
    expect(disposition).not.toMatch(/[^\x20-\x7e"]/);
  });

  it("skips metadata headers but still sends Content-Disposition", async () => {
    storage.get.mockResolvedValue({ stream: Readable.from(["x"]) });
    const mockRes = res();

    await controller.download("a.txt", mockRes);

    const headers = mockRes.setHeader.mock.calls.map(([h]) => h);
    expect(headers).toEqual(["Content-Disposition"]);
  });

  it("404 when storage reports not found", async () => {
    storage.get.mockRejectedValue(new StorageNotFoundError("missing.txt"));

    await expect(controller.download("missing.txt", res())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('bubbles storage failures that are not "not found"', async () => {
    storage.get.mockRejectedValue(new Error("network down"));

    await expect(controller.download("a.txt", res())).rejects.toThrow(
      "network down",
    );
  });

  it("destroys the storage stream when the response closes (client abort)", async () => {
    const stream = Readable.from(["hello"]) as any;
    const destroy = jest.spyOn(stream, "destroy");
    storage.get.mockResolvedValue({ stream });
    const mockRes = res();

    await controller.download("a.txt", mockRes);

    // controller registered the close hook; firing it (Express does this on
    // both abort and normal end) must tear the s3 socket down
    const closeCb = mockRes.on.mock.calls.find(([ev]) => ev === "close")[1];
    closeCb();
    expect(destroy).toHaveBeenCalled();
  });
});
