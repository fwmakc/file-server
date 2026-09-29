import { NotFoundException, StreamableFile } from "@nestjs/common";
import { Readable } from "stream";
import { StorageDownloadController } from "./download.controller";
import { StorageNotFoundError } from "./storage.interface";

describe("StorageDownloadController", () => {
  let storage: { get: jest.Mock };
  let controller: StorageDownloadController;
  const res = () => ({ setHeader: jest.fn() }) as any;

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

  it("skips headers when metadata is absent", async () => {
    storage.get.mockResolvedValue({ stream: Readable.from(["x"]) });
    const mockRes = res();

    await controller.download("a.txt", mockRes);

    expect(mockRes.setHeader).not.toHaveBeenCalled();
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
});
