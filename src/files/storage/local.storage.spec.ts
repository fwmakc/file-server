import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { text } from "stream/consumers";
import { LocalStorage } from "./local.storage";
import { StorageNotFoundError } from "./storage.interface";

describe("LocalStorage", () => {
  let dir: string;
  let storage: LocalStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "file-server-storage-"));
    storage = new LocalStorage(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("put writes the file and creates nested folders", async () => {
    await storage.put("a/b/c.txt", Buffer.from("hello"));

    expect(await readFile(join(dir, "a", "b", "c.txt"), "utf-8")).toBe("hello");
  });

  it("exists reports written and missing keys", async () => {
    expect(await storage.exists("a/b/c.txt")).toBe(false);

    await storage.put("a/b/c.txt", Buffer.from("hello"));

    expect(await storage.exists("a/b/c.txt")).toBe(true);
  });

  it("get returns a readable stream with content length", async () => {
    await storage.put("a/b/c.txt", Buffer.from("hello"));

    const stored = await storage.get("a/b/c.txt");

    expect(stored.contentLength).toBe(5);
    expect(await text(stored.stream as any)).toBe("hello");
  });

  it("get throws StorageNotFoundError for missing keys", async () => {
    await expect(storage.get("missing.txt")).rejects.toThrow(
      StorageNotFoundError,
    );
  });

  it("refuses keys escaping the root", async () => {
    await expect(
      storage.put("../escaped.txt", Buffer.from("x")),
    ).rejects.toThrow(StorageNotFoundError);
    await expect(storage.get("../../etc/passwd")).rejects.toThrow(
      StorageNotFoundError,
    );
  });

  it("delete removes the object", async () => {
    await storage.put("a.txt", Buffer.from("x"));

    await storage.delete("a.txt");

    expect(await storage.exists("a.txt")).toBe(false);
  });
});
