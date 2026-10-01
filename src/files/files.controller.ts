import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFiles,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ApiExcludeController } from "@nestjs/swagger";
import { Multer } from "multer";
import { Account, Data } from "api-server-toolkit";
import { FilesService } from "./files.service";
import { OptionsFilesDto } from "./dto/options.files.dto";

// Direct-upload size ceiling in MB (nginx cuts at the same 50m on /files —
// keep the two aligned). Bigger files go through presigned PUT to the bucket
// instead of buffering here.
export const maxUploadBytes = (): number =>
  (Number(process.env.MAX_UPLOAD_SIZE) > 0
    ? Number(process.env.MAX_UPLOAD_SIZE)
    : 50) *
  1024 *
  1024;

@ApiExcludeController()
@Controller("files")
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Account()
  @Post("upload")
  @UseInterceptors(
    FilesInterceptor("file", 20, { limits: { fileSize: maxUploadBytes() } }),
  )
  async filesUploadImage(
    @UploadedFiles() files: Express.Multer.File[],
    @Data("options") options?: OptionsFilesDto,
  ) {
    return await this.filesService.process(files, options);
  }
}
