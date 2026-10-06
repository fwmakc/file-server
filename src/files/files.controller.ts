import {
  Controller,
  Delete,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseInterceptors,
  UploadedFiles,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ApiExcludeController } from "@nestjs/swagger";
import { Multer } from "multer";
import { Account, Data, Self } from "api-server-toolkit";
import { AccountInfo } from "api-server-toolkit/auth-client";
import { AclService } from "./acl/acl.service";
import { FilesService } from "./files.service";
import { OptionsFilesDto } from "./dto/options.files.dto";
import {
  FILES_STORAGE,
  IFileStorage,
} from "./storage/storage.interface";
import { sanitizeRequestPath } from "./storage/storage.utils";

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
  constructor(
    private readonly filesService: FilesService,
    private readonly acl: AclService,
    @Inject(FILES_STORAGE) private readonly storage: IFileStorage,
  ) {}

  @Account()
  @Post("upload")
  @UseInterceptors(
    FilesInterceptor("file", 20, { limits: { fileSize: maxUploadBytes() } }),
  )
  async filesUploadImage(
    @UploadedFiles() files: Express.Multer.File[],
    @Self() account: AccountInfo,
    @Data("options") options?: OptionsFilesDto,
  ) {
    // The namespace root is stamped from the token; a shared folder passes
    // only with a write grant (or staff). The client never picks the root.
    const resolved = options ?? {};
    resolved.folder = await this.acl.resolveWriteFolder(
      resolved.folder ?? "",
      account,
    );
    return await this.filesService.process(files, resolved);
  }

  @Account()
  @Delete("*splat")
  async remove(
    // Express 5 wildcard parameter array — reassemble (see download).
    @Param("splat") path: string | string[],
    @Self() account: AccountInfo,
  ) {
    const key = sanitizeRequestPath(
      Array.isArray(path) ? path.join("/") : path,
    );
    if (!key || !(await this.storage.exists(key))) {
      throw new NotFoundException();
    }
    // Delete is a write operation; 404 masks existence from strangers.
    if (!(await this.acl.canWrite(key, account))) {
      throw new NotFoundException();
    }
    await this.storage.delete(key);
    await this.acl.removeTree(key);
    return { deleted: true };
  }
}
