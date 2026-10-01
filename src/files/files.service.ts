import { Injectable } from "@nestjs/common";
import { FilesInterface } from "./files.interface";
import { OptionsFilesDto } from "./dto/options.files.dto";
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

@Injectable()
export class FilesService {
  constructor(
    protected readonly allowTypesHandler: AllowTypesHandler,
    protected readonly decodeHandler: DecodeHandler,
    protected readonly getImageMetadataHandler: GetImageMetadataHandler,
    protected readonly imageConvertHandler: ImageConvertHandler,
    protected readonly imageResizeHandler: ImageResizeHandler,
    protected readonly isImageHandler: IsImageHandler,
    protected readonly maxSizeHandler: MaxSizeHandler,
    protected readonly pdfGenerateHandler: PdfGenerateHandler,
    protected readonly renameHandler: RenameHandler,
    protected readonly saveHandler: SaveHandler,
  ) {}

  async fileProcess(file: FilesInterface, options?: OptionsFilesDto) {
    // options are optional on the wire (POST /files/upload without a body):
    // every switch below must treat that as "no transformations"
    const { rename } = options ?? {};

    const fileSize = this.maxSizeHandler.maxSize(file);
    const allowType = this.allowTypesHandler.allowTypes(file);

    if (!fileSize || !allowType) {
      return undefined;
    }

    const isImage = await this.isImageHandler.isImage(file);
    if (isImage) {
      file = await this.imageProcess(file, options);
    }

    if (rename) {
      return await this.renameHandler.rename(file);
    }
    return await this.decodeHandler.decode(file);
  }

  async imageProcess(file: FilesInterface, options?: OptionsFilesDto) {
    const { convert, resize } = options ?? {};

    if (resize) {
      file.buffer = await this.imageResizeHandler.imageResize(file.buffer);
      const { size } = await this.getImageMetadataHandler.getImageMetadata(
        file.buffer,
      );
      file.size = size;
    }

    if (convert) {
      const converted = await this.imageConvertHandler.imageConvert(file);

      file.buffer = converted.buffer;
      file.originalname = converted.originalname;
      file.mimetype = converted.mimetype;
      file.size = converted.size;
    }

    return file;
  }

  async process(files: Express.Multer.File[], options: OptionsFilesDto) {
    const filesList: FilesInterface[] = [];

    for (const item of files) {
      // corrupted image / sharp failure must reject one file, not 500 the
      // whole batch — the rest still uploads and gets per-file statuses
      let processed: FilesInterface;
      try {
        processed = await this.fileProcess(new FilesInterface(item), options);
      } catch (e) {
        filesList.push({
          error:
            "Файл не обработан: " +
            (e instanceof Error ? e.message : String(e)),
          mimetype: item.mimetype,
          originalname: item.originalname,
          size: item.size,
          timestamp: new Date(),
        } as FilesInterface);
        continue;
      }

      if (!processed) {
        // файл отклонён фильтрами (размер/тип): раньше save(undefined)
        // возвращал ошибку, но деструктуризация полей с undefined роняла
        // весь запрос в 500 вместо записи с error в ответе
        filesList.push({
          error: "Файл отклонён: недопустимый размер или тип",
          mimetype: item.mimetype,
          originalname: item.originalname,
          size: item.size,
          timestamp: new Date(),
        } as FilesInterface);
        continue;
      }

      const { error, url } = await this.saveHandler.save(processed, options);
      const { mimetype, originalname, size, timestamp } = processed;

      filesList.push({
        error,
        mimetype,
        originalname,
        size,
        timestamp,
        url,
      });
    }

    return filesList;
  }

  async pdfGenerate(
    template: string,
    data: object = {},
    options: object = {},
  ): Promise<any> {
    return await this.pdfGenerateHandler.pdfGenerate(template, data, options);
  }
}
