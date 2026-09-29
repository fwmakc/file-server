import { SaveHandler, sanitizeFilename } from "./save.handler";
import { FilesInterface } from "../files.interface";

describe("SaveHandler", () => {
  let handler: SaveHandler;
  let storage: {
    put: jest.Mock;
    exists: jest.Mock;
    get: jest.Mock;
    delete: jest.Mock;
  };
  const envBackup = { ...process.env };

  beforeEach(() => {
    storage = {
      put: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      get: jest.fn(),
      delete: jest.fn(),
    };
    handler = new SaveHandler(storage as any);
    process.env.UPLOADS_PATH = "/tmp/uploads";
    process.env.UPLOADS_URL = "http://example.com/files";
    delete process.env.FILE_STORAGE;
    delete process.env.S3_PUBLIC_URL;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  function makeFile(name = "test.txt"): FilesInterface {
    return new FilesInterface({
      buffer: Buffer.from("hello"),
      mimetype: "text/plain",
      originalname: name,
      size: 5,
    } as any);
  }

  describe("save — success path", () => {
    it("stores the file and returns URL", async () => {
      const result = await handler.save(makeFile(), {} as any);

      expect(storage.put).toHaveBeenCalledWith(
        "test.txt",
        Buffer.from("hello"),
        "text/plain",
      );
      expect(result.url).toBe("http://example.com/files/test.txt");
    });

    it("includes folder in key and URL when folder option is provided", async () => {
      const result = await handler.save(makeFile(), {
        folder: "photos",
      } as any);

      expect(storage.put.mock.calls[0][0]).toBe("photos/test.txt");
      expect(result.url).toBe("http://example.com/files/photos/test.txt");
    });

    it("overwrites existing file when replace is true", async () => {
      storage.exists.mockResolvedValue(true);

      const result = await handler.save(makeFile(), { replace: true } as any);

      expect(result.url).toBeDefined();
      expect(storage.put).toHaveBeenCalled();
    });
  });

  describe("save — error paths", () => {
    it("returns error when file already exists and replace is false", async () => {
      storage.exists.mockResolvedValue(true);

      const result = await handler.save(makeFile(), {} as any);

      expect(result.error).toBe("Файл уже существует");
      expect(result.url).toBeUndefined();
      expect(storage.put).not.toHaveBeenCalled();
    });

    it("returns error when storage put fails", async () => {
      storage.put.mockRejectedValue(new Error("EACCES"));

      const result = await handler.save(makeFile(), {} as any);

      expect(result.error).toBe("Ошибка при записи файла");
    });

    it("returns error when file is null/undefined", async () => {
      const result = await handler.save(undefined as any, {} as any);

      expect(result.error).toBe("Файл не задан");
      expect(storage.exists).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe("folder and filename sanitization (path traversal)", () => {
    it("strips non-word characters and traversal from folder", async () => {
      await handler.save(makeFile(), { folder: "../etc/passwd" } as any);

      const key = storage.put.mock.calls[0][0];
      expect(key).not.toContain("..");
      expect(key).toBe("etc/passwd/test.txt");
    });

    it("extracts basename from traversal filenames", async () => {
      await handler.save(makeFile("../../../owned.txt"), {} as any);

      expect(storage.put.mock.calls[0][0]).toBe("owned.txt");
    });

    it("returns error when originalname reduces to nothing", async () => {
      const result = await handler.save(makeFile("../.."), {} as any);

      expect(result.error).toBe("Некорректное имя файла");
      expect(storage.put).not.toHaveBeenCalled();
    });

    it("sanitizeFilename: basenames, dots, control characters", () => {
      expect(sanitizeFilename("../../../../etc/passwd")).toBe("passwd");
      expect(sanitizeFilename("..\\..\\windows\\system32\\evil.dll")).toBe(
        "evil.dll",
      );
      expect(sanitizeFilename("/abs/path/photo.png")).toBe("photo.png");
      expect(sanitizeFilename("..")).toBe("");
      expect(sanitizeFilename(".")).toBe("");
      expect(sanitizeFilename("")).toBe("");
      expect(sanitizeFilename(undefined)).toBe("");
      expect(sanitizeFilename("../../..")).toBe("");
      expect(sanitizeFilename("file\u0000.txt")).toBe("file.txt");
      expect(sanitizeFilename("a\u001fb.png")).toBe("ab.png");
    });
  });

  describe("URL base selection", () => {
    it("uses S3_PUBLIC_URL in s3 mode when configured", async () => {
      process.env.FILE_STORAGE = "s3";
      process.env.S3_PUBLIC_URL = "https://cdn.example.com";

      const result = await handler.save(makeFile(), {} as any);

      expect(result.url).toBe("https://cdn.example.com/test.txt");
    });

    it("falls back to UPLOADS_URL (download proxy) in s3 mode without S3_PUBLIC_URL", async () => {
      process.env.FILE_STORAGE = "s3";

      const result = await handler.save(makeFile(), {} as any);

      expect(result.url).toBe("http://example.com/files/test.txt");
    });

    it("trims trailing slashes from the base", async () => {
      process.env.UPLOADS_URL = "http://example.com/files/";

      const result = await handler.save(makeFile(), {} as any);

      expect(result.url).toBe("http://example.com/files/test.txt");
    });
  });
});
