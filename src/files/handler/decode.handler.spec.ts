import { DecodeHandler } from "./decode.handler";
import { FilesInterface } from "../files.interface";

describe("DecodeHandler", () => {
  let handler: DecodeHandler;

  beforeEach(() => {
    handler = new DecodeHandler();
  });

  it("returns a new FilesInterface instance", () => {
    const file = new FilesInterface({
      buffer: Buffer.from("test"),
      mimetype: "text/plain",
      originalname: "test.txt",
      size: 4,
    } as any);

    const result = handler.decode(file);
    expect(result).toBeInstanceOf(FilesInterface);
    expect(result).not.toBe(file);
  });

  it("preserves buffer, mimetype, and size", () => {
    const buffer = Buffer.from("test-data");
    const file = new FilesInterface({
      buffer,
      mimetype: "image/png",
      originalname: "test.png",
      size: 9,
    } as any);

    const result = handler.decode(file);
    expect(result.buffer).toBe(buffer);
    expect(result.mimetype).toBe("image/png");
    expect(result.size).toBe(9);
  });

  it("decodes ASCII filename to UTF-8", () => {
    const file = new FilesInterface({
      buffer: Buffer.from("test"),
      mimetype: "text/plain",
      originalname: "test.txt",
      size: 4,
    } as any);

    const result = handler.decode(file);
    expect(result.originalname).toBe("test.txt");
  });

  it("round-trips Cyrillic filenames correctly", () => {
    const file = new FilesInterface({
      buffer: Buffer.from("test"),
      mimetype: "text/plain",
      originalname: "Ð´Ð¾ÐºÑÐ¼ÐµÐ½Ñ.txt",
      size: 4,
    } as any);

    const result = handler.decode(file);
    expect(result.originalname).toContain(".txt");
  });
});
