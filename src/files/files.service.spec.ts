import { FilesService } from "./files.service";
import { FilesInterface } from "./files.interface";
import { AllowTypesHandler } from "./handler/allow_types.handler";
import { DecodeHandler } from "./handler/decode.handler";
import { GetImageMetadataHandler } from "./handler/get_image_metadata.handler";
import { ImageConvertHandler } from "./handler/image_convert.handler";
import { ImageResizeHandler } from "./handler/image_resize.handler";
import { IsImageHandler } from "./handler/is_image.handler";
import { MaxSizeHandler } from "./handler/max_size.handler";
import { PdfGenerateHandler } from "./handler/pdf_generate.handler";
import { RenameHandler } from "./handler/rename.handler";
import { SaveHandler } from "./handler/save.handler";

describe("FilesService", () => {
  let service: FilesService;
  let handlers: any;

  beforeEach(() => {
    handlers = {
      allowTypesHandler: { allowTypes: jest.fn().mockReturnValue(true) },
      decodeHandler: { decode: jest.fn() },
      getImageMetadataHandler: { getImageMetadata: jest.fn() },
      imageConvertHandler: { imageConvert: jest.fn() },
      imageResizeHandler: { imageResize: jest.fn() },
      isImageHandler: { isImage: jest.fn().mockResolvedValue(false) },
      maxSizeHandler: { maxSize: jest.fn().mockReturnValue(true) },
      pdfGenerateHandler: { pdfGenerate: jest.fn() },
      renameHandler: { rename: jest.fn() },
      saveHandler: {
        save: jest.fn().mockResolvedValue({ url: "http://example.com/f.png" }),
      },
    };
    service = new FilesService(
      handlers.allowTypesHandler,
      handlers.decodeHandler,
      handlers.getImageMetadataHandler,
      handlers.imageConvertHandler,
      handlers.imageResizeHandler,
      handlers.isImageHandler,
      handlers.maxSizeHandler,
      handlers.pdfGenerateHandler,
      handlers.renameHandler,
      handlers.saveHandler,
    );
  });

  function makeFile(): FilesInterface {
    return new FilesInterface({
      buffer: Buffer.from("test"),
      mimetype: "text/plain",
      originalname: "test.txt",
      size: 4,
    } as any);
  }

  describe("fileProcess", () => {
    it("treats a missing options argument as no transformations", async () => {
      // POST /files/upload may arrive without an options body at all
      const decoded = makeFile();
      handlers.decodeHandler.decode.mockReturnValue(decoded);
      const result = await service.fileProcess(makeFile());
      expect(result).toBe(decoded);
    });

    it("returns undefined when maxSize check fails", async () => {
      handlers.maxSizeHandler.maxSize.mockReturnValue(false);
      const result = await service.fileProcess(makeFile(), {} as any);
      expect(result).toBeUndefined();
    });

    it("returns undefined when allowTypes check fails", async () => {
      handlers.allowTypesHandler.allowTypes.mockReturnValue(false);
      const result = await service.fileProcess(makeFile(), {} as any);
      expect(result).toBeUndefined();
    });

    it("calls decodeHandler when rename option is not set", async () => {
      const decoded = makeFile();
      handlers.decodeHandler.decode.mockReturnValue(decoded);
      const result = await service.fileProcess(makeFile(), {} as any);
      expect(handlers.decodeHandler.decode).toHaveBeenCalled();
      expect(handlers.renameHandler.rename).not.toHaveBeenCalled();
      expect(result).toBe(decoded);
    });

    it("calls renameHandler when rename option is set", async () => {
      const renamed = makeFile();
      handlers.renameHandler.rename.mockReturnValue(renamed);
      const result = await service.fileProcess(makeFile(), {
        rename: true,
      } as any);
      expect(handlers.renameHandler.rename).toHaveBeenCalled();
      expect(handlers.decodeHandler.decode).not.toHaveBeenCalled();
      expect(result).toBe(renamed);
    });

    it("runs image processing for image files", async () => {
      handlers.isImageHandler.isImage.mockResolvedValue(true);
      handlers.imageResizeHandler.imageResize.mockResolvedValue(
        Buffer.from("resized"),
      );
      handlers.getImageMetadataHandler.getImageMetadata.mockResolvedValue({
        size: 7,
      });
      handlers.decodeHandler.decode.mockReturnValue(makeFile());

      await service.fileProcess(makeFile(), { resize: true } as any);

      expect(handlers.imageResizeHandler.imageResize).toHaveBeenCalled();
      expect(
        handlers.getImageMetadataHandler.getImageMetadata,
      ).toHaveBeenCalled();
    });

    it("does NOT run image processing for non-image files", async () => {
      handlers.isImageHandler.isImage.mockResolvedValue(false);
      handlers.decodeHandler.decode.mockReturnValue(makeFile());

      await service.fileProcess(makeFile(), {
        resize: true,
        convert: true,
      } as any);

      expect(handlers.imageResizeHandler.imageResize).not.toHaveBeenCalled();
      expect(handlers.imageConvertHandler.imageConvert).not.toHaveBeenCalled();
    });
  });

  describe("imageProcess", () => {
    it("resizes and updates metadata when resize option is set", async () => {
      const file = makeFile();
      handlers.imageResizeHandler.imageResize.mockResolvedValue(
        Buffer.from("resized"),
      );
      handlers.getImageMetadataHandler.getImageMetadata.mockResolvedValue({
        size: 100,
      });

      const result = await service.imageProcess(file, { resize: true } as any);

      expect(result.size).toBe(100);
    });

    it("converts image when convert option is set", async () => {
      const file = makeFile();
      const converted = new FilesInterface({
        buffer: Buffer.from("webp"),
        mimetype: "image/webp",
        originalname: "out.webp",
        size: 5,
      } as any);
      handlers.imageConvertHandler.imageConvert.mockResolvedValue(converted);

      const result = await service.imageProcess(file, { convert: true } as any);

      expect(result.mimetype).toBe("image/webp");
      expect(result.originalname).toBe("out.webp");
    });

    it("does nothing when neither resize nor convert is set", async () => {
      const file = makeFile();
      const result = await service.imageProcess(file, {} as any);
      expect(result).toBe(file);
      expect(handlers.imageResizeHandler.imageResize).not.toHaveBeenCalled();
      expect(handlers.imageConvertHandler.imageConvert).not.toHaveBeenCalled();
    });
  });

  describe("process", () => {
    it("processes multiple files and returns results array", async () => {
      const files = [
        {
          buffer: Buffer.from("a"),
          mimetype: "text/plain",
          originalname: "a.txt",
          size: 1,
        },
        {
          buffer: Buffer.from("bb"),
          mimetype: "text/plain",
          originalname: "b.txt",
          size: 2,
        },
      ] as any[];

      handlers.decodeHandler.decode.mockImplementation((file: any) => file);

      const result = await service.process(files, {} as any);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty("url");
      expect(result[0]).toHaveProperty("mimetype");
      expect(result[0]).toHaveProperty("originalname");
      expect(result[0]).toHaveProperty("size");
      expect(result[0]).toHaveProperty("timestamp");
    });

    it("handles save errors gracefully", async () => {
      handlers.decodeHandler.decode.mockImplementation((file: any) => file);
      handlers.saveHandler.save.mockResolvedValue({
        error: "Файл уже существует",
      });

      const result = await service.process(
        [
          {
            buffer: Buffer.from("a"),
            mimetype: "text/plain",
            originalname: "a.txt",
            size: 1,
          },
        ] as any[],
        {} as any,
      );

      expect(result[0].error).toBe("Файл уже существует");
    });

    it("returns an error entry (not a 500) for a file rejected by filters", async () => {
      // раньше fileProcess → undefined, save(undefined) давал error,
      // но деструктуризация полей с undefined роняла весь запрос
      handlers.maxSizeHandler.maxSize.mockReturnValue(false);
      handlers.saveHandler.save.mockClear();

      const result = await service.process(
        [
          {
            buffer: Buffer.from("aaaa"),
            mimetype: "application/zip",
            originalname: "big.zip",
            size: 999999,
          },
        ] as any[],
        {} as any,
      );

      expect(result).toHaveLength(1);
      expect(result[0].error).toContain("отклонён");
      expect(result[0].originalname).toBe("big.zip");
      expect(result[0].url).toBeUndefined();
      expect(handlers.saveHandler.save).not.toHaveBeenCalled();
    });
  });

  describe("pdfGenerate", () => {
    it("delegates to pdfGenerateHandler", async () => {
      handlers.pdfGenerateHandler.pdfGenerate.mockResolvedValue(
        Buffer.from("pdf"),
      );
      const result = await service.pdfGenerate("invoice", { total: 100 });
      expect(handlers.pdfGenerateHandler.pdfGenerate).toHaveBeenCalledWith(
        "invoice",
        { total: 100 },
        {},
      );
      expect(result).toEqual(Buffer.from("pdf"));
    });
  });
});
